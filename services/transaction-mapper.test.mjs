/**
 * ============================================================================
 * TRANSACTION MAPPER — UNIT TEST SUITE
 * ============================================================================
 * Tests:
 *  1.  1:1 Resolution by payment_reference (primary key)
 *  2.  1:1 Resolution by employee_id (secondary fallback)
 *  3.  Orphaned row detection (no matching instruction)
 *  4.  Fan-in collision — two bank rows claim the same instruction
 *  5.  Anti-assumption guard — mapper output never carries status = PAID
 *  6.  Index warnings for duplicate payment_reference in batch
 *  7.  Index warnings for duplicate employee_id in batch
 *  8.  MatchStrategy correctly set for each resolution path
 *  9.  Blank txn_id + employee_id falls through to UNMATCHED
 * 10.  Instruction normalisation — flexible field aliases accepted
 *
 * Run:
 *   node --experimental-vm-modules services/transaction-mapper.test.mjs
 *
 * @version 1.0.0
 */

import assert from 'node:assert/strict';
import { TransactionMapper, MatchStrategy, InstructionIndexWarning } from './transaction-mapper.mjs';

// ─── Test harness ─────────────────────────────────────────────────────────────
let passed = 0;
let failed = 0;

async function test(name, fn) {
  try {
    await fn();
    console.log(`  ✅  ${name}`);
    passed++;
  } catch (err) {
    console.error(`  ❌  ${name}`);
    console.error(`       ${err.message}`);
    failed++;
  }
}

// ─── Fixtures ─────────────────────────────────────────────────────────────────

function makeInstruction(overrides = {}) {
  return {
    record_id:          overrides.record_id      || 'REC-001',
    batch_id:           overrides.batch_id       || 'BATCH-001',
    employee_id:        overrides.employee_id    || 'EMP-001',
    employee_name:      overrides.employee_name  || 'Alice Sharma',
    payment_reference:  overrides.payment_reference || 'KYLRX-DISB-001',
    net_payable_amount: overrides.net_payable_amount ?? 50000,
    status:             overrides.status         || 'PENDING',
    ifsc_code:          overrides.ifsc_code      || 'HDFC0001234',
    account_number_masked: '••••1234',
    ...overrides,
  };
}

function makeBankRow(overrides = {}) {
  // Simulates a normalised BankClearingRow from the engine's parser
  return {
    txn_id:                  overrides.txn_id       ?? 'KYLRX-DISB-001',
    bank_ref:                overrides.bank_ref      ?? 'UTR-ABC-123',
    employee_id:             overrides.employee_id   ?? 'EMP-001',
    cleared_amount:          overrides.cleared_amount ?? 50000,
    raw_status:              overrides.raw_status    ?? 'PAID',
    normalised_status:       overrides.normalised_status ?? 'PAID',
    failure_reason:          overrides.failure_reason ?? null,
    error_code:              overrides.error_code    ?? null,
    settlement_timestamp:    new Date().toISOString(),
    bank_confirmation_present: overrides.bank_confirmation_present ?? true,
  };
}

// ─── Test Suite ───────────────────────────────────────────────────────────────

console.log('\n══════════════════════════════════════════════════');
console.log('  TRANSACTION MAPPER — UNIT TESTS');
console.log('══════════════════════════════════════════════════\n');

const mapper = new TransactionMapper({ verbose: false });

// ── Test 1: 1:1 resolution via payment_reference ────────────────────────────
await test('1:1 resolution — primary key (payment_reference / txn_id)', () => {
  const inst = makeInstruction({ payment_reference: 'KYLRX-DISB-001', employee_id: 'EMP-001' });
  const { byRef, byEmpId } = mapper.buildInstructionIndex([inst]);

  const row = makeBankRow({ txn_id: 'KYLRX-DISB-001', employee_id: 'EMP-001' });
  const result = mapper.mapBankResponseFeed('BATCH-001', [row], byRef, byEmpId);

  assert.equal(result.matched_count, 1, 'Should have 1 matched pair');
  assert.equal(result.unmatched_count, 0, 'Should have 0 unmatched rows');
  assert.equal(result.matched_pairs[0].match_strategy, MatchStrategy.PAYMENT_REFERENCE);
  assert.equal(result.matched_pairs[0].match_key, 'KYLRX-DISB-001');
  assert.equal(result.matched_pairs[0].instruction.employee_id, 'EMP-001');
});

// ── Test 2: 1:1 resolution via employee_id (fallback) ───────────────────────
await test('1:1 resolution — secondary fallback (employee_id)', () => {
  const inst = makeInstruction({ payment_reference: 'KYLRX-DISB-999', employee_id: 'EMP-002' });
  const { byRef, byEmpId } = mapper.buildInstructionIndex([inst]);

  // Bank row carries no txn_id but has employee_id
  const row = makeBankRow({ txn_id: '', employee_id: 'EMP-002' });
  const result = mapper.mapBankResponseFeed('BATCH-001', [row], byRef, byEmpId);

  assert.equal(result.matched_count, 1);
  assert.equal(result.matched_pairs[0].match_strategy, MatchStrategy.EMPLOYEE_ID);
  assert.equal(result.matched_pairs[0].match_key, 'EMP-002');
});

// ── Test 3: Orphaned row — no matching instruction ───────────────────────────
await test('Orphaned row — no matching instruction produces mapper exception', () => {
  const inst = makeInstruction({ payment_reference: 'KYLRX-DISB-001', employee_id: 'EMP-001' });
  const { byRef, byEmpId } = mapper.buildInstructionIndex([inst]);

  // Bank row references an unknown employee / txn_id
  const row = makeBankRow({ txn_id: 'UNKNOWN-TXN', employee_id: 'EMP-GHOST' });
  const result = mapper.mapBankResponseFeed('BATCH-001', [row], byRef, byEmpId);

  assert.equal(result.matched_count, 0);
  assert.equal(result.unmatched_count, 1);
  assert.equal(result.mapper_exceptions.length, 1);
  assert.equal(result.mapper_exceptions[0].code, 'ORPHANED_ROW');
  assert.ok(result.mapper_exceptions[0].reason.includes('UNKNOWN-TXN'));
});

// ── Test 4: Fan-in collision — two rows claim same instruction ───────────────
await test('Fan-in collision — two bank rows resolve to the same instruction', () => {
  const inst = makeInstruction({ payment_reference: 'KYLRX-DISB-001', employee_id: 'EMP-001' });
  const { byRef, byEmpId } = mapper.buildInstructionIndex([inst]);

  const row1 = makeBankRow({ txn_id: 'KYLRX-DISB-001', bank_ref: 'UTR-A' });
  const row2 = makeBankRow({ txn_id: 'KYLRX-DISB-001', bank_ref: 'UTR-B' }); // duplicate claim

  const result = mapper.mapBankResponseFeed('BATCH-001', [row1, row2], byRef, byEmpId);

  assert.equal(result.matched_count, 2, 'Both rows in matched_pairs (with collision flag)');
  const collision = result.matched_pairs.find((p) => p.has_fan_in_collision);
  assert.ok(collision, 'Second pair should carry has_fan_in_collision=true');
  const fanInExc = result.mapper_exceptions.find((e) => e.code === 'DUPLICATE_INSTRUCTION_CLAIM');
  assert.ok(fanInExc, 'Should have a DUPLICATE_INSTRUCTION_CLAIM mapper exception');
});

// ── Test 5: Anti-assumption guard — mapper NEVER writes status = PAID ────────
await test('Anti-assumption guard — mapper output never sets status = PAID', () => {
  const inst = makeInstruction({ status: 'PENDING' });
  const { byRef, byEmpId } = mapper.buildInstructionIndex([inst]);

  const row = makeBankRow({ normalised_status: 'PAID', bank_confirmation_present: true });
  const result = mapper.mapBankResponseFeed('BATCH-001', [row], byRef, byEmpId);

  // The instruction object inside the matched pair must NOT have status = PAID
  const pair = result.matched_pairs[0];
  assert.ok(pair, 'Should have a matched pair');
  assert.notEqual(pair.instruction.status, 'PAID',
    'Mapper must NOT write PAID on the instruction — only ReconciliationEngine.applyPaidStatus() may do this');
  // Original instruction is also untouched
  assert.equal(inst.status, 'PENDING');
});

// ── Test 6: Duplicate payment_reference in batch triggers index warning ───────
await test('Duplicate payment_reference in batch → index warning, first occurrence wins', () => {
  const inst1 = makeInstruction({ record_id: 'REC-001', payment_reference: 'KYLRX-DISB-001', employee_id: 'EMP-001' });
  const inst2 = makeInstruction({ record_id: 'REC-002', payment_reference: 'KYLRX-DISB-001', employee_id: 'EMP-002' }); // same ref!

  const { byRef, byEmpId, warnings } = mapper.buildInstructionIndex([inst1, inst2]);

  const dupWarning = warnings.find((w) => w.code === InstructionIndexWarning.DUPLICATE_PAYMENT_REFERENCE);
  assert.ok(dupWarning, 'Should emit a DUPLICATE_PAYMENT_REFERENCE warning');
  // First occurrence should win
  assert.equal(byRef.get('KYLRX-DISB-001').record_id, 'REC-001', 'First occurrence should win the index slot');
});

// ── Test 7: Duplicate employee_id in batch triggers index warning ─────────────
await test('Duplicate employee_id in batch → index warning', () => {
  const inst1 = makeInstruction({ record_id: 'REC-A', employee_id: 'EMP-DUP', payment_reference: 'REF-A' });
  const inst2 = makeInstruction({ record_id: 'REC-B', employee_id: 'EMP-DUP', payment_reference: 'REF-B' });

  const { warnings } = mapper.buildInstructionIndex([inst1, inst2]);

  const dupWarning = warnings.find((w) => w.code === InstructionIndexWarning.DUPLICATE_EMPLOYEE_ID);
  assert.ok(dupWarning, 'Should emit a DUPLICATE_EMPLOYEE_ID warning');
});

// ── Test 8: MatchStrategy is correct for each resolution path ─────────────────
await test('MatchStrategy enum values are correctly tagged per match type', () => {
  const instA = makeInstruction({ payment_reference: 'KYLRX-001', employee_id: 'EREF-001' });
  const instB = makeInstruction({ record_id: 'REC-002', payment_reference: 'KYLRX-002', employee_id: 'EREF-002' });

  const { byRef, byEmpId } = mapper.buildInstructionIndex([instA, instB]);

  const rowPrimary   = makeBankRow({ txn_id: 'KYLRX-001', employee_id: '' });
  const rowSecondary = makeBankRow({ txn_id: '',           employee_id: 'EREF-002' });
  const rowNone      = makeBankRow({ txn_id: 'UNKNOWN',    employee_id: 'NOBODY' });

  const result = mapper.mapBankResponseFeed('BATCH-001',
    [rowPrimary, rowSecondary, rowNone], byRef, byEmpId);

  assert.equal(result.matched_pairs[0].match_strategy, MatchStrategy.PAYMENT_REFERENCE);
  assert.equal(result.matched_pairs[1].match_strategy, MatchStrategy.EMPLOYEE_ID);
  assert.equal(result.unmatched_rows[0].txn_id, 'UNKNOWN');
});

// ── Test 9: Blank txn_id + blank employee_id → UNMATCHED ─────────────────────
await test('Blank txn_id and blank employee_id both → UNMATCHED / ORPHANED_ROW', () => {
  const inst = makeInstruction();
  const { byRef, byEmpId } = mapper.buildInstructionIndex([inst]);

  const emptyRow = makeBankRow({ txn_id: '', employee_id: '', bank_ref: 'UTR-X' });
  const result = mapper.mapBankResponseFeed('BATCH-001', [emptyRow], byRef, byEmpId);

  assert.equal(result.unmatched_count, 1);
  assert.equal(result.mapper_exceptions[0].code, 'ORPHANED_ROW');
});

// ── Test 10: Instruction field aliases are normalised ─────────────────────────
await test('Instruction field aliases (net, id, ref) are correctly normalised', () => {
  // Simulates a record using non-canonical field names
  const rawRecord = {
    id:              'ALIAS-EMP',
    ref:             'ALIAS-REF-001',
    net:             75000,
    name:            'Alias Employee',
    status:          'PENDING',
    ifsc:            'ICIC0002345',
    accountNumberMasked: '••••5678',
  };

  const { byRef, byEmpId } = mapper.buildInstructionIndex([rawRecord]);

  // Should be indexed by the alias ref
  assert.ok(byRef.has('ALIAS-REF-001'), 'Alias ref should be indexed');
  assert.ok(byEmpId.has('ALIAS-EMP'), 'Alias employee_id should be indexed');

  const row = makeBankRow({ txn_id: 'ALIAS-REF-001', employee_id: 'ALIAS-EMP' });
  const result = mapper.mapBankResponseFeed('BATCH-001', [row], byRef, byEmpId);

  assert.equal(result.matched_count, 1);
  assert.equal(result.matched_pairs[0].instruction.instructed_amount, 75000,
    'net field alias should produce correct instructed_amount');
});

// ── Summary ──────────────────────────────────────────────────────────────────
console.log(`\n──────────────────────────────────────────────────`);
console.log(`  Results: ${passed} passed, ${failed} failed`);
console.log(`──────────────────────────────────────────────────\n`);

if (failed > 0) process.exit(1);
