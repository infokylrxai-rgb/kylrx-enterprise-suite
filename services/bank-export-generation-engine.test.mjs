/**
 * ============================================================================
 * KYLRX AI ENTERPRISE HRMS - CRITERIA 5 & 6 BANK EXPORT TEST SUITE
 * ============================================================================
 * Tests verifying:
 *   Criteria 5: Metadata & SHA-256 Checksumming (BankFile document persistence:
 *               file_id, version, checksum, source_batch_id, row_count, total_amount, generated_at)
 *   Criteria 6: Strict Idempotency (Distributed locking, Instruction Key formula,
 *               409 Duplicate Prevention, Auditable Reissue/Reversal Workflow)
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import crypto from 'node:crypto';

import {
  BankExportGenerationEngine,
  computeInstructionKey,
  DistributedLockManager,
  globalLockManager,
  InstructionExecutionStore,
  globalInstructionExecutionStore,
  DuplicateInstructionConflictError,
  bankFileStore,
} from './bank-export-generation-engine.mjs';

import {
  FileService,
  PaymentBatchService,
  store,
  resetDisbursementMicroserviceStores,
  createDisbursementApiRouter,
} from './payroll-disbursement-api.mjs';

test('🏦 KYLRX AI CRITERIA 5 & 6: BANK EXPORT GENERATION & IDEMPOTENCY SUITE', async (t) => {

  t.beforeEach(() => {
    resetDisbursementMicroserviceStores();
  });

  // ==========================================================================
  // CRITERIA 5: METADATA & CHECKSUMMING
  // ==========================================================================
  await t.test('CRITERIA 5: Bank File Compilation, Metadata & SHA-256 Checksumming', async (t5) => {

    await t5.test('5.1 Compiles NEFT/RTGS CSV, computes SHA-256 checksum across raw content, and persists BankFile document', async () => {
      const batchId = 'BATCH_CRIT5_001';
      const batch = {
        batch_id: batchId,
        period: '2026-08',
        batch_type: 'SALARY',
        state: 'APPROVED',
        status: 'APPROVED',
        total_amount: 150000,
        records: [
          {
            employee_id: 'EMP_001',
            employee_name: 'Aditi Rao',
            net_payable: 50000,
            account_number: '50100411223344',
            ifsc_code: 'HDFC0001234',
            payment_reference: 'REF_001',
          },
          {
            employee_id: 'EMP_002',
            employee_name: 'Brijesh Patel',
            net_payable: 100000,
            account_number: '50100455667788',
            ifsc_code: 'ICIC0005678',
            payment_reference: 'REF_002',
          },
        ],
      };
      store.paymentBatches.set(batchId, batch);

      const fileMeta = await FileService.generateFile(batchId);

      // 1. Assert BankFile metadata fields exist as required by Criteria 5
      assert.ok(fileMeta.file_id, 'Must contain file_id');
      assert.strictEqual(fileMeta.version, 1, 'Initial version must be 1');
      assert.ok(fileMeta.checksum, 'Must contain checksum');
      assert.strictEqual(fileMeta.checksum.length, 64, 'Checksum must be 64-character SHA-256 hex');
      assert.strictEqual(fileMeta.source_batch_id, batchId, 'source_batch_id must match');
      assert.strictEqual(fileMeta.row_count, 2, 'row_count must match records count');
      assert.strictEqual(fileMeta.total_amount, 150000, 'total_amount must match');
      assert.ok(fileMeta.generated_at, 'Must contain generated_at timestamp');

      // 2. Mathematically verify SHA-256 hash matches the raw output content
      const expectedChecksum = crypto
        .createHash('sha256')
        .update(fileMeta.content, 'utf8')
        .digest('hex');
      assert.strictEqual(fileMeta.checksum, expectedChecksum, 'Calculated SHA-256 must match raw content');

      // 3. Verify persistence in BankFile store
      const persistedBankFile = store.bankFiles.get(fileMeta.file_id);
      assert.ok(persistedBankFile, 'Must be persisted in store.bankFiles');
      assert.strictEqual(persistedBankFile.checksum, expectedChecksum);
      assert.strictEqual(persistedBankFile.source_batch_id, batchId);
      assert.strictEqual(persistedBankFile.version, 1);
    });

    await t5.test('5.2 Engine supports TXT delimited output format with accurate SHA-256 digest', async () => {
      const engine = new BankExportGenerationEngine({
        fileStore: bankFileStore,
        instructionStore: globalInstructionExecutionStore,
        lockManager: globalLockManager,
      });

      const batch = {
        batch_id: 'BATCH_TXT_001',
        period: '2026-08',
        batch_type: 'SALARY',
        records: [
          {
            employee_id: 'EMP_TXT',
            employee_name: 'Chetan Bhagat',
            net_payable: 250000, // RTGS
            account_number: '50100499001122',
            ifsc_code: 'SBIN0001234',
            payment_reference: 'REF_TXT_1',
          },
        ],
      };

      const bankFile = await engine.generateBankFile({
        batch,
        format: 'TXT',
      });

      assert.strictEqual(bankFile.format, 'TXT');
      assert.ok(bankFile.content.includes('|RTGS|'));
      const contentHash = crypto.createHash('sha256').update(bankFile.content, 'utf8').digest('hex');
      assert.strictEqual(bankFile.checksum, contentHash);
    });
  });

  // ==========================================================================
  // CRITERIA 6: STRICT IDEMPOTENCY & DUPLICATE PREVENTION
  // ==========================================================================
  await t.test('CRITERIA 6: Strict Idempotency, Distributed Locking & Auditable Reissue', async (t6) => {

    await t6.test('6.1 Deterministic Instruction Key matches formula: SHA256(period + employee_id + batch_type + amount + account_version)', () => {
      const params = {
        period: '2026-08',
        employee_id: 'EMP_X',
        batch_type: 'SALARY',
        amount: 45000,
        account_version: 1,
      };

      const key1 = computeInstructionKey(params);
      const key2 = computeInstructionKey(params);

      // Exact canonical manual hash
      const manualRaw = '2026-08EMP_XSALARY45000.001';
      const manualExpected = crypto.createHash('sha256').update(manualRaw, 'utf8').digest('hex');

      assert.strictEqual(key1, key2, 'Deterministic key generation must be stable');
      assert.strictEqual(key1, manualExpected, 'Matches exact SHA-256 formula composition');
      assert.strictEqual(key1.length, 64);
    });

    await t6.test('6.2 Distributed Locking Mechanism: Prevents concurrent export execution races', async () => {
      const lockManager = new DistributedLockManager();
      const resource = 'batch_concurrent_lock_test';

      let firstExecutionStarted = false;
      let secondExecutionFailedWithLock = false;

      // First task holds lock
      const task1 = lockManager.withLock(resource, async () => {
        firstExecutionStarted = true;
        // Simulate in-flight processing delay
        await new Promise((resolve) => setTimeout(resolve, 50));
        return 'TASK_1_DONE';
      }, { holderId: 'WORKER_NODE_1' });

      // Second task attempts concurrent acquisition on the same resource
      const task2 = (async () => {
        while (!firstExecutionStarted) {
          await new Promise((resolve) => setTimeout(resolve, 2));
        }
        try {
          await lockManager.withLock(resource, async () => 'TASK_2_DONE', { holderId: 'WORKER_NODE_2' });
        } catch (err) {
          if (err.statusCode === 409 && err.code === 'CONCURRENT_EXPORT_LOCK_CONFLICT') {
            secondExecutionFailedWithLock = true;
          }
        }
      })();

      const [res1] = await Promise.all([task1, task2]);
      assert.strictEqual(res1, 'TASK_1_DONE');
      assert.strictEqual(secondExecutionFailedWithLock, true, 'Concurrent lock must reject second caller with 409');
    });

    await t6.test('6.3 Duplicate Prevention: Rejects duplicate file generation with 409 Conflict when instruction hashes were previously processed', async () => {
      const batchId1 = 'BATCH_DUP_ORIGINAL';
      const batch1 = {
        batch_id: batchId1,
        period: '2026-08',
        batch_type: 'SALARY',
        state: 'APPROVED',
        status: 'APPROVED',
        total_amount: 50000,
        records: [
          {
            employee_id: 'EMP_DUP_1',
            employee_name: 'Dinesh Karthik',
            net_payable: 50000,
            account_number: '50100411112222',
            ifsc_code: 'HDFC0001234',
            payment_reference: 'REF_DUP_1',
          },
        ],
      };
      store.paymentBatches.set(batchId1, batch1);

      // Generate initial file successfully
      const file1 = await FileService.generateFile(batchId1);
      assert.ok(file1.file_id);

      // Attempt to generate file again on a batch containing the SAME instruction key
      const batchId2 = 'BATCH_DUP_ATTEMPT';
      const batch2 = {
        batch_id: batchId2,
        period: '2026-08', // Same period
        batch_type: 'SALARY', // Same batch type
        state: 'APPROVED',
        status: 'APPROVED',
        total_amount: 50000,
        records: [
          {
            employee_id: 'EMP_DUP_1', // Same employee
            employee_name: 'Dinesh Karthik',
            net_payable: 50000, // Same amount
            account_number: '50100411112222',
            ifsc_code: 'HDFC0001234',
            payment_reference: 'REF_DUP_2',
          },
        ],
      };
      store.paymentBatches.set(batchId2, batch2);

      // Must reject with 409 Conflict
      await assert.rejects(
        async () => {
          await FileService.generateFile(batchId2);
        },
        (err) => {
          assert.strictEqual(err.statusCode, 409, 'Must return HTTP 409 Conflict');
          assert.strictEqual(err.code, 'DUPLICATE_INSTRUCTION_HASH');
          assert.strictEqual(err.details.duplicate_count, 1);
          assert.strictEqual(err.details.duplicates[0].employee_id, 'EMP_DUP_1');
          assert.match(err.message, /Duplicate file generation rejected/);
          return true;
        }
      );
    });

    await t6.test('6.4 Auditable Reissue Workflow: Allows regeneration only through explicit reissue with version increment and audit logging', async () => {
      const batchId = 'BATCH_REISSUE_MASTER';
      const batch = {
        batch_id: batchId,
        period: '2026-08',
        batch_type: 'SALARY',
        state: 'APPROVED',
        status: 'APPROVED',
        total_amount: 80000,
        records: [
          {
            employee_id: 'EMP_REISSUE_1',
            employee_name: 'Esha Gupta',
            net_payable: 80000,
            account_number: '50100499887711',
            ifsc_code: 'ICIC0001122',
            payment_reference: 'REF_REISSUE_1',
          },
        ],
      };
      store.paymentBatches.set(batchId, batch);

      // 1. Generate version 1 file
      const initialFile = await FileService.generateFile(batchId);
      assert.strictEqual(initialFile.version, 1);
      const fileIdV1 = initialFile.file_id;

      // 2. Immediate direct generation attempt fails with 409 Conflict
      batch.state = 'APPROVED'; // Reset state to APPROVED to verify idempotency duplicate guard triggers 409
      await assert.rejects(
        async () => {
          await FileService.generateFile(batchId);
        },
        (err) => {
          assert.strictEqual(err.statusCode, 409);
          assert.strictEqual(err.code, 'DUPLICATE_INSTRUCTION_HASH');
          return true;
        }
      );

      // 3. Attempting reissue without mandatory reason is rejected
      await assert.rejects(
        async () => {
          await FileService.reissueFile(batchId, {
            reason: '', // Empty reason!
            reissued_by: 'admin@kylrx.ai',
          });
        },
        (err) => {
          assert.strictEqual(err.statusCode, 400);
          assert.match(err.message, /auditable justification reason is required/);
          return true;
        }
      );

      // 4. Controlled, explicit reissue with authorized reason and operator identity
      const reissuedFile = await FileService.reissueFile(batchId, {
        previous_file_id: fileIdV1,
        reason: 'Bank reported transmission timeout on host-to-host gateway; reissuing clearing batch.',
        reissued_by: 'finance_controller@kylrx.ai',
        signature: 'ADMIN_HMAC_SIG_9876543210',
      });

      // Assert version incremented
      assert.strictEqual(reissuedFile.version, 2, 'Version must be incremented to 2');
      assert.notEqual(reissuedFile.file_id, fileIdV1, 'New file must have unique file_id');
      assert.strictEqual(reissuedFile.reissued_from_file_id, fileIdV1);
      assert.strictEqual(reissuedFile.reissued_by, 'finance_controller@kylrx.ai');
      assert.strictEqual(reissuedFile.row_count, 1);
      assert.strictEqual(reissuedFile.total_amount, 80000);
      assert.ok(reissuedFile.checksum);

      // Assert audit log captures reissue event
      const reissueLog = store.auditLogs.find((l) => l.event === 'DISBURSEMENT_FILE_REISSUED');
      assert.ok(reissueLog, 'Audit trail must capture DISBURSEMENT_FILE_REISSUED');
      assert.strictEqual(reissueLog.actor_id, 'finance_controller@kylrx.ai');
    });

    await t6.test('6.5 REST API: POST /payment-batches/:id/reissue-file endpoint integration', async () => {
      const app = express();
      const router = createDisbursementApiRouter();
      app.use('/api', router);

      const batchId = 'BATCH_REST_REISSUE';
      const batch = {
        batch_id: batchId,
        period: '2026-08',
        batch_type: 'SALARY',
        state: 'APPROVED',
        status: 'APPROVED',
        total_amount: 35000,
        records: [
          {
            employee_id: 'EMP_REST_1',
            employee_name: 'Farhan Akhtar',
            net_payable: 35000,
            account_number: '50100433221100',
            ifsc_code: 'HDFC0005678',
            payment_reference: 'REF_REST_1',
          },
        ],
      };
      store.paymentBatches.set(batchId, batch);

      // Generate V1
      await FileService.generateFile(batchId);

      const server = app.listen(0);
      const port = server.address().port;
      const baseUrl = `http://127.0.0.1:${port}`;

      try {
        // Execute POST /api/payment-batches/:id/reissue-file
        const response = await fetch(`${baseUrl}/api/payment-batches/${batchId}/reissue-file`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            reason: 'Correcting bank gateway clearing routing code',
            reissued_by: 'head_treasury@kylrx.ai',
          }),
        });

        assert.strictEqual(response.status, 201);
        const body = await response.json();
        assert.strictEqual(body.success, true);
        assert.strictEqual(body.data.version, 2);
        assert.strictEqual(body.data.source_batch_id, batchId);
      } finally {
        server.close();
      }
    });
  });

});
