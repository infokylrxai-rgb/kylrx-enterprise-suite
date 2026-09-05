import test from 'node:test';
import assert from 'node:assert/strict';
import {
  IdempotencyUniquenessEngine,
  InstructionExecutionLedger,
  generateDeterministicInstructionKey,
  signReissueAuthorization,
  IdempotencyConflictError,
  UnauthorizedReissueError,
  InvalidSignatureError,
} from './idempotency-uniqueness-engine.mjs';

test('🔒 KYLRX AI IDEMPOTENCY & UNIQUENESS ENFORCEMENT ENGINE TEST SUITE', async (t) => {
  const SECRET_KEY = 'TEST_SIGNING_KEY_2026';

  await t.test('1. Deterministic Key Generation: Identical Inputs Yield Exactly Identical SHA-256 Keys', () => {
    const inputA = {
      period: 'September 2026',
      employee_id: 'EMP101',
      batch_type: 'SALARY',
      amount: 45000,
      bank_account_version: 1,
    };

    const inputB = {
      period: 'September 2026',
      employee_id: 'EMP101',
      batch_type: 'SALARY',
      amount: 45000,
      bank_account_version: 1,
    };

    const keyA = generateDeterministicInstructionKey(inputA);
    const keyB = generateDeterministicInstructionKey(inputB);

    assert.equal(keyA.instruction_key, keyB.instruction_key);
    assert.equal(keyA.instruction_id, keyB.instruction_id);
    assert.ok(keyA.instruction_id.startsWith('INS-'));
    assert.equal(keyA.instruction_key.length, 64);
  });

  await t.test('2. Stamping Batch Records: Stamped records contain deterministic instruction_id and instruction_key', () => {
    const engine = new IdempotencyUniquenessEngine({ signingSecret: SECRET_KEY });
    const batch = { period: 'September 2026', batch_type: 'SALARY' };
    const records = [
      { employee_id: 'EMP101', net_payable_amount: 45000, bank_account_version: 1 },
      { employee_id: 'EMP102', net_payable_amount: 55000, bank_account_version: 2 },
    ];

    const stamped = engine.stampBatchInstructions(batch, records);
    assert.equal(stamped.length, 2);
    assert.ok(stamped[0].instruction_id);
    assert.ok(stamped[0].instruction_key);
    assert.notEqual(stamped[0].instruction_id, stamped[1].instruction_id);
  });

  await t.test('3. Export & Submission Protection: Automatic 409 Conflict on Re-submission of Executed Instruction', async () => {
    const ledger = new InstructionExecutionLedger();
    const engine = new IdempotencyUniquenessEngine({ ledger, signingSecret: SECRET_KEY });

    const batch = { period: 'September 2026', batch_type: 'SALARY' };
    const records = [{ employee_id: 'EMP101', net_payable_amount: 45000, bank_account_version: 1 }];
    const stamped = engine.stampBatchInstructions(batch, records);

    // Initial commit -> Success
    await engine.commitInstructions(stamped, {
      batch_id: 'BATCH-SEP2026-SALARY-01',
      executed_by: 'OPERATOR_1',
      channel: 'BANK_API',
    });

    // Attempting to submit the identical instructions again must throw IdempotencyConflictError (409)
    await assert.rejects(
      async () => {
        await engine.verifyAndGuardInstructions(stamped, { batch_id: 'BATCH-SEP2026-SALARY-02' });
      },
      (err) => {
        assert.ok(err instanceof IdempotencyConflictError);
        assert.equal(err.statusCode, 409);
        assert.equal(err.details.duplicate_count, 1);
        assert.equal(err.details.duplicates[0].instruction_id, stamped[0].instruction_id);
        return true;
      }
    );
  });

  await t.test('4. API-Level Pre-Execution Middleware: Intercepts and aborts with 409 Conflict on duplicates', async () => {
    const ledger = new InstructionExecutionLedger();
    const engine = new IdempotencyUniquenessEngine({ ledger, signingSecret: SECRET_KEY });

    const batch = { period: 'September 2026', batch_type: 'SALARY' };
    const records = [{ employee_id: 'EMP101', net_payable_amount: 45000, bank_account_version: 1 }];
    const stamped = engine.stampBatchInstructions(batch, records);

    // Seed ledger with committed instruction
    await engine.commitInstructions(stamped, { batch_id: 'BATCH-01', executed_by: 'ADMIN' });

    const middleware = engine.createIdempotencyGuardMiddleware({ channel: 'BANK_FILE_GENERATION' });

    // Mock Express request and response
    let nextCalled = false;
    const req = {
      params: { batchId: 'BATCH-02' },
      body: {
        period: 'September 2026',
        batch_type: 'SALARY',
        records: [{ employee_id: 'EMP101', net_payable_amount: 45000, bank_account_version: 1 }],
      },
    };

    const res = {
      statusCode: 200,
      body: null,
      status(code) {
        this.statusCode = code;
        return this;
      },
      json(data) {
        this.body = data;
        return this;
      },
    };

    const next = () => {
      nextCalled = true;
    };

    await middleware(req, res, next);

    assert.equal(nextCalled, false);
    assert.equal(res.statusCode, 409);
    assert.equal(res.body.error, '409_CONFLICT_DOUBLE_DISBURSEMENT_BLOCKED');
    assert.equal(res.body.details.duplicate_count, 1);
  });

  await t.test('5. Cryptographically Signed Reissue Flow: Enforces Signature Verification and RBAC Authorization', async () => {
    const ledger = new InstructionExecutionLedger();
    const engine = new IdempotencyUniquenessEngine({ ledger, signingSecret: SECRET_KEY });

    const batch = { period: 'September 2026', batch_type: 'SALARY' };
    const records = [{ employee_id: 'EMP101', net_payable_amount: 45000, bank_account_version: 1 }];
    const [original] = engine.stampBatchInstructions(batch, records);

    await engine.commitInstructions([original], { batch_id: 'BATCH-01', executed_by: 'ADMIN' });

    const validUser = { user_id: 'ADMIN_PRIYA', role: 'PAYROLL_ADMIN' };
    const invalidUser = { user_id: 'OPERATOR_BOB', role: 'PAYROLL_OPERATOR' };
    const reason = 'Correcting returned bank transfer';

    // A. Unprivileged actor rejected with 403 Forbidden
    await assert.rejects(
      async () => {
        await engine.executeControlledReissue({
          original_instruction_id: original.instruction_id,
          requestingUser: invalidUser,
          reason,
          signature: 'dummy_signature',
        });
      },
      (err) => {
        assert.ok(err instanceof UnauthorizedReissueError);
        assert.equal(err.statusCode, 403);
        return true;
      }
    );

    // B. Privileged actor with missing or invalid signature rejected with 401
    await assert.rejects(
      async () => {
        await engine.executeControlledReissue({
          original_instruction_id: original.instruction_id,
          requestingUser: validUser,
          reason,
          signature: 'forged_invalid_signature_hex',
        });
      },
      (err) => {
        assert.ok(err instanceof InvalidSignatureError);
        assert.equal(err.statusCode, 401);
        return true;
      }
    );

    // C. Privileged actor with VALID cryptographic signature succeeds
    const validSignature = signReissueAuthorization(
      {
        action: 'REISSUE_OR_REVERSAL',
        instruction_id: original.instruction_id,
        authorized_by: validUser.user_id,
        reason: reason.trim(),
      },
      SECRET_KEY
    );

    const reissueResult = await engine.executeControlledReissue({
      original_instruction_id: original.instruction_id,
      requestingUser: validUser,
      reason,
      signature: validSignature,
      new_bank_account_version: 2,
    });

    assert.equal(reissueResult.success, true);
    assert.equal(reissueResult.original_status, 'REVERSED');
    assert.equal(reissueResult.reissued_instruction.reissue_sequence, 1);
    assert.notEqual(reissueResult.reissued_instruction.instruction_id, original.instruction_id);
    assert.equal(reissueResult.reissue_audit_log.signature, validSignature);

    // D. The newly minted reissued instruction can now be safely executed
    const guardCheck = await engine.verifyAndGuardInstructions([reissueResult.reissued_instruction], {
      batch_id: 'REISSUE_BATCH',
    });
    assert.equal(guardCheck.allowed, true);
  });
});
