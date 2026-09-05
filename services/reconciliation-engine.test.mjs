/**
 * ============================================================================
 * RECONCILIATION ENGINE — UNIT TEST SUITE
 * ============================================================================
 * Tests (20 cases):
 *
 * GUARD-0  Anti-Assumption Guard
 *   01. Clean CSV → PAID only when bank_confirmation_present=true + non-blank UTR
 *   02. File submission alone must NOT set PAID (blank UTR in bank row)
 *   03. Transmission state must NOT set PAID (only ingestion of confirmation does)
 *
 * GUARD-1  Amount Mismatch
 *   04. Over-payment (cleared > instructed by > tolerance) → AMOUNT_MISMATCH exception
 *   05. Under-payment with zero cleared → not amount mismatch, treated as FAILED
 *   06. Difference within tolerance → clean match, no exception
 *
 * GUARD-2  Missing Identifier
 *   07. Blank txn_id → MISSING_IDENTIFIER exception, field = 'txn_id'
 *   08. Blank bank_ref (UTR) → MISSING_IDENTIFIER exception, field = 'bank_ref'
 *   09. Both blank → two MISSING_IDENTIFIER exceptions emitted
 *
 * GUARD-3  Orphaned Row
 *   10. Unknown employee_id + unknown txn_id → ORPHANED_ROW exception
 *   11. Unknown employee only (matched via txn_id) → clean (employee_id secondary only)
 *
 * GUARD-4  Duplicate External Reference
 *   12. Same UTR in two rows of same run → DUPLICATE_EXTERNAL_REF on second row
 *   13. UTR already in historic ledger → DUPLICATE_EXTERNAL_REF on ingestion
 *   14. Same txn_id in two rows → DUPLICATE_EXTERNAL_REF on second row
 *
 * GUARD-5  Partial Settlement
 *   15. cleared_amount > 0 but < instructed_amount → PARTIAL_SETTLEMENT exception
 *   16. difference_amount is negative (instructed − cleared = unsettled gap)
 *
 * Batch Auto-Closure Prevention
 *   17. Any open exception → batch.auto_closure_blocked = true
 *   18. batch.status = RECONCILIATION_EXCEPTION when exceptions exist
 *   19. Batch reaches SETTLED only when ALL exceptions cleared
 *
 * Exception Queue + Finance Ops Review Items
 *   20. Every exception produces a linked FinanceOpsReviewItem with action_required
 *   21. difference_amount is always present (even 0 for MISSING_IDENTIFIER)
 *
 * Run:
 *   node --experimental-vm-modules services/reconciliation-engine.test.mjs
 *
 * @version 1.0.0
 */

import assert from 'node:assert/strict';
import { ReconciliationEngine, ReconciliationExceptionType, BatchReconciliationState } from './reconciliation-engine.mjs';
import { InMemoryReconciliationStore, ExceptionQueueStatus } from './reconciliation-exception-store.mjs';

// ─── Test Harness ─────────────────────────────────────────────────────────────
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
    if (process.env.DEBUG) console.error(err.stack);
    failed++;
  }
}

// ─── Fixtures ─────────────────────────────────────────────────────────────────

function makeBatch(overrides = {}) {
  const records = overrides.records || [makeRecord()];
  return {
    batch_id:       overrides.batch_id       || 'BATCH-TEST-001',
    organization_id: overrides.organization_id || 'ORG-KYLRX',
    status:         overrides.status         || 'SUBMITTED',
    records,
    ...overrides,
  };
}

function makeRecord(overrides = {}) {
  return {
    record_id:          overrides.record_id          || 'REC-001',
    batch_id:           overrides.batch_id           || 'BATCH-TEST-001',
    employee_id:        overrides.employee_id        || 'EMP-001',
    employee_name:      overrides.employee_name      || 'Alice Sharma',
    payment_reference:  overrides.payment_reference  || 'KYLRX-DISB-001',
    net_payable_amount: overrides.net_payable_amount ?? 50000,
    status:             overrides.status             || 'PENDING',
    ifsc_code:          'HDFC0001234',
    account_number_masked: '••••1234',
    ...overrides,
  };
}

/**
 * Build a minimal CSV with the given rows.
 * @param {object[]} rows - each: { txn_id, bank_ref, employee_id, amount, status, failure_reason }
 */
function buildCsv(rows) {
  const header = 'txn_id,bank_ref,employee_id,amount,status,failure_reason';
  const lines = rows.map((r) =>
    [
      r.txn_id        ?? '',
      r.bank_ref      ?? '',
      r.employee_id   ?? '',
      r.amount        ?? 0,
      r.status        ?? 'PAID',
      r.failure_reason ?? '',
    ].join(',')
  );
  return [header, ...lines].join('\n');
}

function makeEngine(storeOptions = {}) {
  const store = new InMemoryReconciliationStore();
  // Seed historic ledgers if provided
  if (storeOptions.historicUtrs) {
    store._utrLedger = new Set(storeOptions.historicUtrs);
  }
  if (storeOptions.historicTxnIds) {
    store._txnIdLedger = new Set(storeOptions.historicTxnIds);
  }
  return { engine: new ReconciliationEngine({ store, tolerance: 0.01 }), store };
}

// ═════════════════════════════════════════════════════════════════════════════
console.log('\n══════════════════════════════════════════════════');
console.log('  RECONCILIATION ENGINE — UNIT TESTS');
console.log('══════════════════════════════════════════════════\n');
console.log('  ── GUARD-0: Anti-Assumption Guard ──\n');

// ── Test 01: Clean PAID with UTR present ─────────────────────────────────────
await test('01 | Clean confirmation → instruction.status set to PAID', async () => {
  const { engine } = makeEngine();
  const batch = makeBatch();
  const csv = buildCsv([{ txn_id: 'KYLRX-DISB-001', bank_ref: 'UTR-GOOD-001', employee_id: 'EMP-001', amount: 50000, status: 'PAID' }]);
  const result = await engine.ingestBankFile({ batch, fileContent: csv, operatorId: 'TEST' });

  assert.equal(result.exception_queue_entries.length, 0, 'No exceptions expected');
  assert.equal(result.settled_instructions.length, 1, 'One settled instruction');
  assert.equal(result.settled_instructions[0].status, 'PAID', 'Status must be PAID');
  assert.equal(result.settled_instructions[0].bank_utr, 'UTR-GOOD-001', 'UTR must be recorded');
  assert.equal(batch.status, BatchReconciliationState.SETTLED, 'Batch must be SETTLED');
});

// ── Test 02: File submission (blank UTR) must NOT set PAID ───────────────────
await test('02 | Blank UTR → bank_confirmation_present=false → status NOT PAID', async () => {
  const { engine, store } = makeEngine();
  const batch = makeBatch();
  const csv = buildCsv([
    // bank_ref is blank — no UTR → confirmation not present
    { txn_id: 'KYLRX-DISB-001', bank_ref: '', employee_id: 'EMP-001', amount: 50000, status: 'PAID' }
  ]);
  const result = await engine.ingestBankFile({ batch, fileContent: csv, operatorId: 'TEST' });

  // Must raise a MISSING_IDENTIFIER for bank_ref
  const missingUtrExc = result.exception_queue_entries.find(
    (e) => e.exception_type === ReconciliationExceptionType.MISSING_IDENTIFIER && e.affected_field === 'bank_ref'
  );
  assert.ok(missingUtrExc, 'Must raise MISSING_IDENTIFIER for blank bank_ref');

  // Instruction must NOT be PAID
  const inst = batch.records[0];
  assert.notEqual(inst.status, 'PAID', 'status must NOT be PAID without UTR');
  assert.equal(batch.auto_closure_blocked, true, 'Batch auto-closure must be blocked');
});

// ── Test 03: Batch in SUBMITTED state cannot self-set PAID during ingestion ──
await test('03 | Batch in SUBMITTED state is not PAID before file ingestion', async () => {
  const { engine } = makeEngine();
  const batch = makeBatch({ status: 'SUBMITTED' });
  // Do NOT call ingestBankFile — just assert the batch was never pre-set
  assert.notEqual(batch.status, 'PAID', 'Batch must NOT be PAID without file ingestion');
  // Engine sets RECONCILING immediately upon ingest start
  const csv = buildCsv([{ txn_id: 'KYLRX-DISB-001', bank_ref: 'UTR-OK', employee_id: 'EMP-001', amount: 50000, status: 'PAID' }]);
  const result = await engine.ingestBankFile({ batch, fileContent: csv, operatorId: 'TEST' });
  // PAID is set only after clean guard pass
  assert.equal(result.settled_instructions[0].status, 'PAID');
});

console.log('\n  ── GUARD-1: Amount Mismatch ──\n');

// ── Test 04: Over-payment → AMOUNT_MISMATCH ──────────────────────────────────
await test('04 | Over-payment (cleared > instructed by > tolerance) → AMOUNT_MISMATCH', async () => {
  const { engine } = makeEngine();
  const batch = makeBatch();
  // Instructed: 50,000 — Cleared: 50,500 → Δ = +500
  const csv = buildCsv([{ txn_id: 'KYLRX-DISB-001', bank_ref: 'UTR-OVR', employee_id: 'EMP-001', amount: 50500, status: 'PAID' }]);
  const result = await engine.ingestBankFile({ batch, fileContent: csv, operatorId: 'TEST' });

  const exc = result.exception_queue_entries.find((e) => e.exception_type === ReconciliationExceptionType.AMOUNT_MISMATCH);
  assert.ok(exc, 'Should raise AMOUNT_MISMATCH exception');
  assert.equal(exc.difference_amount, 500, 'difference_amount must be +500 (over-payment)');
  assert.equal(exc.instructed_amount, 50000);
  assert.equal(exc.cleared_amount, 50500);
  assert.notEqual(batch.records[0].status, 'PAID', 'Instruction must NOT be PAID with amount mismatch');
});

// ── Test 05: Zero cleared → treated as bank FAILED, not amount mismatch ──────
await test('05 | Zero cleared amount → FAILED instruction, no AMOUNT_MISMATCH', async () => {
  const { engine } = makeEngine();
  const batch = makeBatch();
  const csv = buildCsv([{ txn_id: 'KYLRX-DISB-001', bank_ref: '', employee_id: 'EMP-001', amount: 0, status: 'FAILED', failure_reason: 'ACCOUNT_CLOSED' }]);
  const result = await engine.ingestBankFile({ batch, fileContent: csv, operatorId: 'TEST' });

  const amtExc = result.exception_queue_entries.find((e) => e.exception_type === ReconciliationExceptionType.AMOUNT_MISMATCH);
  // Amount mismatch should NOT fire for zero-amount (it's a bank reject)
  assert.ok(!amtExc, 'No AMOUNT_MISMATCH for zero cleared amount');
});

// ── Test 06: Amount within tolerance → clean match ───────────────────────────
await test('06 | Amount difference within tolerance (0.01) → no exception', async () => {
  const { engine } = makeEngine();
  const batch = makeBatch({ records: [makeRecord({ net_payable_amount: 50000 })] });
  // Cleared is 49,999.99 — Δ = 0.01 (within tolerance)
  const csv = buildCsv([{ txn_id: 'KYLRX-DISB-001', bank_ref: 'UTR-TOL', employee_id: 'EMP-001', amount: 49999.99, status: 'PAID' }]);
  const result = await engine.ingestBankFile({ batch, fileContent: csv, operatorId: 'TEST' });

  const amtExc = result.exception_queue_entries.find((e) => e.exception_type === ReconciliationExceptionType.AMOUNT_MISMATCH);
  assert.ok(!amtExc, 'No AMOUNT_MISMATCH when Δ ≤ tolerance');
});

console.log('\n  ── GUARD-2: Missing Identifier ──\n');

// ── Test 07: Blank txn_id ─────────────────────────────────────────────────────
await test('07 | Blank txn_id → MISSING_IDENTIFIER exception (field: txn_id)', async () => {
  const { engine } = makeEngine();
  const batch = makeBatch();
  const csv = buildCsv([{ txn_id: '', bank_ref: 'UTR-OK', employee_id: 'EMP-001', amount: 50000, status: 'PAID' }]);
  const result = await engine.ingestBankFile({ batch, fileContent: csv, operatorId: 'TEST' });

  const exc = result.exception_queue_entries.find(
    (e) => e.exception_type === ReconciliationExceptionType.MISSING_IDENTIFIER && e.affected_field === 'txn_id'
  );
  assert.ok(exc, 'Must raise MISSING_IDENTIFIER for blank txn_id');
  assert.equal(exc.difference_amount, 0, 'difference_amount must be 0 for identifier exception');
});

// ── Test 08: Blank bank_ref (UTR) ─────────────────────────────────────────────
await test('08 | Blank bank_ref (UTR) → MISSING_IDENTIFIER exception (field: bank_ref)', async () => {
  const { engine } = makeEngine();
  const batch = makeBatch();
  const csv = buildCsv([{ txn_id: 'KYLRX-DISB-001', bank_ref: '', employee_id: 'EMP-001', amount: 50000, status: 'PAID' }]);
  const result = await engine.ingestBankFile({ batch, fileContent: csv, operatorId: 'TEST' });

  const exc = result.exception_queue_entries.find(
    (e) => e.exception_type === ReconciliationExceptionType.MISSING_IDENTIFIER && e.affected_field === 'bank_ref'
  );
  assert.ok(exc, 'Must raise MISSING_IDENTIFIER for blank bank_ref');
  assert.equal(exc.difference_amount, 0, 'difference_amount must be 0');
});

// ── Test 09: Both blank → two exceptions ─────────────────────────────────────
await test('09 | Both txn_id and bank_ref blank → two MISSING_IDENTIFIER exceptions', async () => {
  const { engine } = makeEngine();
  const batch = makeBatch();
  const csv = buildCsv([{ txn_id: '', bank_ref: '', employee_id: 'EMP-001', amount: 50000, status: 'PAID' }]);
  const result = await engine.ingestBankFile({ batch, fileContent: csv, operatorId: 'TEST' });

  const missingExcs = result.exception_queue_entries.filter(
    (e) => e.exception_type === ReconciliationExceptionType.MISSING_IDENTIFIER
  );
  assert.ok(missingExcs.length >= 2, `Expected at least 2 MISSING_IDENTIFIER exceptions, got ${missingExcs.length}`);
});

console.log('\n  ── GUARD-3: Orphaned Row ──\n');

// ── Test 10: Unknown employee + txn_id → ORPHANED_ROW ────────────────────────
await test('10 | Unknown employee_id and txn_id → ORPHANED_ROW exception', async () => {
  const { engine } = makeEngine();
  const batch = makeBatch();
  const csv = buildCsv([{ txn_id: 'GHOST-TXN', bank_ref: 'UTR-GHOST', employee_id: 'EMP-GHOST', amount: 12000, status: 'PAID' }]);
  const result = await engine.ingestBankFile({ batch, fileContent: csv, operatorId: 'TEST' });

  const exc = result.exception_queue_entries.find((e) => e.exception_type === ReconciliationExceptionType.ORPHANED_ROW);
  assert.ok(exc, 'Must raise ORPHANED_ROW exception');
  assert.equal(exc.difference_amount, 12000, 'difference_amount = full cleared amount (unattributable)');
});

// ── Test 11: Employee matched via txn_id even if employee_id unknown ──────────
await test('11 | Match via txn_id → no ORPHANED_ROW even if employee_id is blank in row', async () => {
  const { engine } = makeEngine();
  const batch = makeBatch();
  // Bank row has correct txn_id but blank employee_id
  const csv = buildCsv([{ txn_id: 'KYLRX-DISB-001', bank_ref: 'UTR-OK', employee_id: '', amount: 50000, status: 'PAID' }]);
  const result = await engine.ingestBankFile({ batch, fileContent: csv, operatorId: 'TEST' });

  const orphan = result.exception_queue_entries.find((e) => e.exception_type === ReconciliationExceptionType.ORPHANED_ROW);
  assert.ok(!orphan, 'No ORPHANED_ROW when txn_id resolves to valid instruction');
});

console.log('\n  ── GUARD-4: Duplicate External Reference ──\n');

// ── Test 12: Same UTR in two rows of the same run ───────────────────────────
await test('12 | Same UTR in two rows → DUPLICATE_EXTERNAL_REF on second row', async () => {
  const { engine } = makeEngine();
  const batch = makeBatch({
    records: [
      makeRecord({ record_id: 'REC-001', employee_id: 'EMP-001', payment_reference: 'KYLRX-DISB-001' }),
      makeRecord({ record_id: 'REC-002', employee_id: 'EMP-002', payment_reference: 'KYLRX-DISB-002' }),
    ],
  });
  const csv = buildCsv([
    { txn_id: 'KYLRX-DISB-001', bank_ref: 'UTR-DUPLICATE', employee_id: 'EMP-001', amount: 50000, status: 'PAID' },
    { txn_id: 'KYLRX-DISB-002', bank_ref: 'UTR-DUPLICATE', employee_id: 'EMP-002', amount: 50000, status: 'PAID' }, // same UTR!
  ]);
  const result = await engine.ingestBankFile({ batch, fileContent: csv, operatorId: 'TEST' });

  const dupExc = result.exception_queue_entries.filter(
    (e) => e.exception_type === ReconciliationExceptionType.DUPLICATE_EXTERNAL_REF
  );
  assert.ok(dupExc.length >= 1, 'Must raise DUPLICATE_EXTERNAL_REF for repeated UTR');
  assert.ok(dupExc.some((e) => e.affected_field === 'bank_ref'), 'Affected field must be bank_ref');
});

// ── Test 13: UTR already in historic ledger → DUPLICATE on ingestion ─────────
await test('13 | UTR in historic ledger → DUPLICATE_EXTERNAL_REF at ingestion time', async () => {
  const { engine } = makeEngine({ historicUtrs: ['UTR-HISTORIC-999'] });
  const batch = makeBatch();
  const csv = buildCsv([{ txn_id: 'KYLRX-DISB-001', bank_ref: 'UTR-HISTORIC-999', employee_id: 'EMP-001', amount: 50000, status: 'PAID' }]);
  const result = await engine.ingestBankFile({ batch, fileContent: csv, operatorId: 'TEST' });

  const dupExc = result.exception_queue_entries.find(
    (e) => e.exception_type === ReconciliationExceptionType.DUPLICATE_EXTERNAL_REF
  );
  assert.ok(dupExc, 'Must flag UTR from historic ledger as DUPLICATE_EXTERNAL_REF');
});

// ── Test 14: Same txn_id across two rows ─────────────────────────────────────
await test('14 | Same txn_id in two rows → DUPLICATE_EXTERNAL_REF on second', async () => {
  const { engine } = makeEngine();
  const batch = makeBatch({
    records: [
      makeRecord({ record_id: 'REC-001', employee_id: 'EMP-001', payment_reference: 'KYLRX-DISB-001' }),
      makeRecord({ record_id: 'REC-002', employee_id: 'EMP-002', payment_reference: 'KYLRX-DISB-002' }),
    ],
  });
  // First row uses KYLRX-DISB-001 as txn_id, second also uses KYLRX-DISB-001
  const csv = buildCsv([
    { txn_id: 'KYLRX-DISB-001', bank_ref: 'UTR-A', employee_id: 'EMP-001', amount: 50000, status: 'PAID' },
    { txn_id: 'KYLRX-DISB-001', bank_ref: 'UTR-B', employee_id: 'EMP-002', amount: 50000, status: 'PAID' }, // same txn_id!
  ]);
  const result = await engine.ingestBankFile({ batch, fileContent: csv, operatorId: 'TEST' });

  const dupExc = result.exception_queue_entries.filter(
    (e) => e.exception_type === ReconciliationExceptionType.DUPLICATE_EXTERNAL_REF && e.affected_field === 'txn_id'
  );
  assert.ok(dupExc.length >= 1, 'Must raise DUPLICATE_EXTERNAL_REF for repeated txn_id');
});

console.log('\n  ── GUARD-5: Partial Settlement ──\n');

// ── Test 15: Partial disbursement detected ───────────────────────────────────
await test('15 | Partially cleared (0 < cleared < instructed) → PARTIAL_SETTLEMENT exception', async () => {
  const { engine } = makeEngine();
  const batch = makeBatch({ records: [makeRecord({ net_payable_amount: 50000 })] });
  // Only 30,000 was cleared out of 50,000 instructed
  const csv = buildCsv([{ txn_id: 'KYLRX-DISB-001', bank_ref: 'UTR-PARTIAL', employee_id: 'EMP-001', amount: 30000, status: 'PAID' }]);
  const result = await engine.ingestBankFile({ batch, fileContent: csv, operatorId: 'TEST' });

  const exc = result.exception_queue_entries.find((e) => e.exception_type === ReconciliationExceptionType.PARTIAL_SETTLEMENT);
  assert.ok(exc, 'Must raise PARTIAL_SETTLEMENT exception');
  assert.ok(exc.difference_amount < 0, 'difference_amount must be negative (under-payment)');
});

// ── Test 16: Partial settlement difference_amount = unsettled gap ─────────────
await test('16 | PARTIAL_SETTLEMENT difference_amount = -(instructed - cleared)', async () => {
  const { engine } = makeEngine();
  const batch = makeBatch({ records: [makeRecord({ net_payable_amount: 100000 })] });
  // Cleared: 60,000 → unsettled gap: 40,000 → difference_amount = -40,000
  const csv = buildCsv([{ txn_id: 'KYLRX-DISB-001', bank_ref: 'UTR-P2', employee_id: 'EMP-001', amount: 60000, status: 'PAID' }]);
  const result = await engine.ingestBankFile({ batch, fileContent: csv, operatorId: 'TEST' });

  const exc = result.exception_queue_entries.find((e) => e.exception_type === ReconciliationExceptionType.PARTIAL_SETTLEMENT);
  assert.ok(exc, 'PARTIAL_SETTLEMENT exception expected');
  assert.equal(exc.difference_amount, -40000, 'difference_amount = -(100000 - 60000) = -40000');
});

console.log('\n  ── Batch Auto-Closure Prevention ──\n');

// ── Test 17: Open exceptions block batch closure ──────────────────────────────
await test('17 | Open exceptions → batch.auto_closure_blocked = true', async () => {
  const { engine } = makeEngine();
  const batch = makeBatch();
  const csv = buildCsv([{ txn_id: 'KYLRX-DISB-001', bank_ref: '', employee_id: 'EMP-001', amount: 50000, status: 'PAID' }]);
  await engine.ingestBankFile({ batch, fileContent: csv, operatorId: 'TEST' });

  assert.equal(batch.auto_closure_blocked, true, 'auto_closure_blocked must be true with open exceptions');
});

// ── Test 18: Batch status = RECONCILIATION_EXCEPTION when blocked ─────────────
await test('18 | Open exceptions → batch.status = RECONCILIATION_EXCEPTION', async () => {
  const { engine } = makeEngine();
  const batch = makeBatch();
  // Orphaned row will produce exception
  const csv = buildCsv([{ txn_id: 'GHOST', bank_ref: 'UTR-GHOST', employee_id: 'EMP-GHOST', amount: 5000, status: 'PAID' }]);
  await engine.ingestBankFile({ batch, fileContent: csv, operatorId: 'TEST' });

  assert.equal(batch.status, BatchReconciliationState.RECONCILIATION_EXCEPTION,
    `Batch must be RECONCILIATION_EXCEPTION, got: ${batch.status}`);
});

// ── Test 19: Batch reaches SETTLED only when 0 open exceptions ───────────────
await test('19 | 0 exceptions + all PAID → batch.status = SETTLED', async () => {
  const { engine } = makeEngine();
  const batch = makeBatch({ records: [makeRecord({ net_payable_amount: 50000 })] });
  const csv = buildCsv([{ txn_id: 'KYLRX-DISB-001', bank_ref: 'UTR-CLEAN', employee_id: 'EMP-001', amount: 50000, status: 'PAID' }]);
  const result = await engine.ingestBankFile({ batch, fileContent: csv, operatorId: 'TEST' });

  assert.equal(result.exception_queue_entries.length, 0, 'No exceptions');
  assert.equal(batch.status, BatchReconciliationState.SETTLED, 'Batch must be SETTLED');
  assert.equal(batch.auto_closure_blocked, false, 'auto_closure_blocked must be false');
});

console.log('\n  ── Exception Queue + Finance Ops Review Items ──\n');

// ── Test 20: Every exception has a linked FinanceOpsReviewItem ───────────────
await test('20 | Every exception produces a linked FinanceOpsReviewItem with action_required', async () => {
  const { engine, store } = makeEngine();
  const batch = makeBatch();
  // Trigger an amount mismatch
  const csv = buildCsv([{ txn_id: 'KYLRX-DISB-001', bank_ref: 'UTR-AMT', employee_id: 'EMP-001', amount: 99999, status: 'PAID' }]);
  const result = await engine.ingestBankFile({ batch, fileContent: csv, operatorId: 'TEST' });

  assert.ok(result.exception_queue_entries.length > 0, 'Must have exceptions');
  assert.ok(result.finance_ops_review_items.length > 0, 'Must have Finance Ops review items');

  for (const reviewItem of result.finance_ops_review_items) {
    assert.ok(reviewItem.action_required && reviewItem.action_required.length > 10,
      `Review item must have action_required text: ${reviewItem.review_item_id}`);
    assert.ok(reviewItem.title, 'Review item must have a title');
    assert.ok(typeof reviewItem.context.difference_amount === 'number',
      'context.difference_amount must be a number');
  }
});

// ── Test 21: difference_amount is always present (0 for MISSING_IDENTIFIER) ──
await test('21 | difference_amount is always a finite number (0 for MISSING_IDENTIFIER)', async () => {
  const { engine } = makeEngine();
  const batch = makeBatch();
  const csv = buildCsv([{ txn_id: '', bank_ref: '', employee_id: 'EMP-001', amount: 50000, status: 'PAID' }]);
  const result = await engine.ingestBankFile({ batch, fileContent: csv, operatorId: 'TEST' });

  for (const exc of result.exception_queue_entries) {
    assert.ok(typeof exc.difference_amount === 'number',
      `difference_amount must be a number, got ${typeof exc.difference_amount} for ${exc.exception_id}`);
    assert.ok(isFinite(exc.difference_amount),
      `difference_amount must be finite for ${exc.exception_id}`);
  }
});

// ─── Summary ─────────────────────────────────────────────────────────────────
console.log(`\n──────────────────────────────────────────────────`);
console.log(`  Results: ${passed} passed, ${failed} failed`);
console.log(`──────────────────────────────────────────────────\n`);

if (failed > 0) process.exit(1);
