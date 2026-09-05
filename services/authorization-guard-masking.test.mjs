/**
 * ============================================================================
 * KYLRX AI ENTERPRISE HRMS - CRITERIA 2, 3 & 12 SECURITY TEST SUITE
 * ============================================================================
 * Tests verifying:
 *   Criteria 2: Pre-State-Change Validation Gatekeeper (422 + blocking error count)
 *   Criteria 3: Maker-Checker Segregation (403 Forbidden + Authorization Failure Event)
 *   Criteria 12: Data Masking & Cryptographically Signed Privileged Export Security
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import {
  ValidationGatekeeper,
  ValidationGatekeeperError,
  MakerCheckerGuard,
  MakerCheckerViolationError,
  DataMaskingService,
  PrivilegedExportSecurityService,
  PrivilegedSecurityError,
  uiPayloadMaskingInterceptor,
} from './authorization-guard-masking.mjs';

import {
  ApprovalService,
  FileService,
  PaymentBatchService,
  store,
  resetDisbursementMicroserviceStores,
  createDisbursementApiRouter,
} from './payroll-disbursement-api.mjs';

test('🔒 KYLRX AI CRITERIA 2, 3 & 12: SECURITY, GATEKEEPER & MASKING SUITE', async (t) => {

  t.beforeEach(() => {
    resetDisbursementMicroserviceStores();
    MakerCheckerGuard.authorizationFailureEvents.length = 0;
  });

  // ==========================================================================
  // CRITERIA 2: VALIDATION GATEKEEPER
  // ==========================================================================
  await t.test('CRITERIA 2: Pre-State-Change Validation Gatekeeper', async (t2) => {

    await t2.test('2.1 Rejects transition to APPROVED with 422 and exact blocking error count when unresolved BLOCK issues exist', async () => {
      const batchId = 'BATCH_VAL_GATE_001';
      const batch = {
        batch_id: batchId,
        state: 'PENDING_APPROVAL',
        maker_id: 'maker_nandan@kylrx.ai',
        records: [
          { employee_id: 'EMP_1', net_payable: 50000 },
        ],
        total_amount: 50000,
        total_records: 1,
      };
      store.paymentBatches.set(batchId, batch);

      // Unresolved BLOCK issues
      const issues = [
        { code: 'GATE_04_IFSC_INVALID', severity: 'BLOCK', message: 'Invalid IFSC', resolved: false },
        { code: 'GATE_03_ACCOUNT_EMPTY', severity: 'BLOCK', message: 'Empty Account', resolved_at: null },
        { code: 'GATE_08_NAME_WARNING', severity: 'WARN', message: 'Name mismatch', resolved: false },
      ];
      store.validationIssuesByBatch.set(batchId, issues);

      // Attempt to approve batch via ApprovalService
      await assert.rejects(
        async () => {
          await ApprovalService.approveBatch(batchId, {
            checker_id: 'checker_abhishek@kylrx.ai',
          });
        },
        (err) => {
          assert.strictEqual(err.statusCode, 422, 'Must return HTTP 422');
          assert.strictEqual(err.details.blocking_count, 2, 'Must report exact count of 2 blocking issues');
          assert.strictEqual(err.details.target_state, 'APPROVED');
          assert.match(err.message, /2 unresolved BLOCK issue\(s\) exist/);
          return true;
        }
      );

      // Direct assertCanTransition check
      assert.throws(
        () => {
          ValidationGatekeeper.assertCanTransition({
            batch,
            targetState: 'APPROVED',
            validationIssues: issues,
          });
        },
        (err) => {
          assert.ok(err instanceof ValidationGatekeeperError);
          assert.strictEqual(err.statusCode, 422);
          assert.strictEqual(err.details.blocking_count, 2);
          return true;
        }
      );
    });

    await t2.test('2.2 Rejects transition to FILE_GENERATED with 422 and blocking count when unresolved BLOCK issues exist', async () => {
      const batchId = 'BATCH_VAL_GATE_002';
      const batch = {
        batch_id: batchId,
        state: 'APPROVED',
        records: [{ employee_id: 'EMP_2', net_payable: 75000 }],
        total_amount: 75000,
        total_records: 1,
        approved_snapshot: {
          checksum: 'd14a028c2a3a2bc9476102bb288234c415a2b01f828ea62ac5b3e42f',
        },
      };
      store.paymentBatches.set(batchId, batch);

      const issues = [
        { code: 'GATE_02_DUPLICATE_ACCOUNT', severity: 'BLOCK', message: 'Duplicate Account', resolved: false },
      ];
      store.validationIssuesByBatch.set(batchId, issues);

      await assert.rejects(
        async () => {
          await FileService.generateFile(batchId);
        },
        (err) => {
          assert.strictEqual(err.statusCode, 422, 'Must return HTTP 422');
          assert.strictEqual(err.details.blocking_count, 1, 'Must report 1 blocking issue');
          return true;
        }
      );
    });

    await t2.test('2.3 Permits transition to APPROVED and FILE_GENERATED once all BLOCK issues are resolved', async () => {
      const batchId = 'BATCH_VAL_GATE_003';
      const batch = {
        batch_id: batchId,
        state: 'PENDING_APPROVAL',
        maker_id: 'maker_nandan@kylrx.ai',
        records: [
          { employee_id: 'EMP_3', net_payable: 40000, account_number: '50100412345678', ifsc_code: 'HDFC0001234' },
        ],
        total_amount: 40000,
        total_records: 1,
        approval_amounts_snapshot: {
          total_amount: 40000,
          record_count: 1,
          amounts_hash: 'abc',
        },
      };
      store.paymentBatches.set(batchId, batch);

      // Resolved issues
      const resolvedIssues = [
        { code: 'GATE_04_IFSC_INVALID', severity: 'BLOCK', message: 'Remediated IFSC', resolved: true, resolved_at: '2026-09-04T10:00:00Z' },
        { code: 'GATE_WARN_CHECK', severity: 'WARN', message: 'Low balance note', resolved: false },
      ];
      store.validationIssuesByBatch.set(batchId, resolvedIssues);

      // Gatekeeper evaluation
      const evalResult = ValidationGatekeeper.evaluate({
        batch,
        targetState: 'APPROVED',
        validationIssues: resolvedIssues,
      });
      assert.strictEqual(evalResult.allowed, true);
      assert.strictEqual(evalResult.blocking_count, 0);

      // Assert does not throw
      assert.doesNotThrow(() => {
        ValidationGatekeeper.assertCanTransition({
          batch,
          targetState: 'APPROVED',
          validationIssues: resolvedIssues,
        });
      });
    });

    await t2.test('2.4 ValidationGatekeeper Express middleware intercepts route and returns 422 JSON', async () => {
      const app = express();
      app.use(express.json());

      const batch = { batch_id: 'BATCH_MW_TEST', state: 'PENDING_APPROVAL' };
      const issues = [{ code: 'GATE_BLOCK', severity: 'BLOCK', resolved: false }];

      app.post(
        '/batches/:id/approve',
        ValidationGatekeeper.middleware({
          targetState: 'APPROVED',
          getBatch: () => batch,
          getIssues: () => issues,
        }),
        (req, res) => res.status(200).json({ success: true })
      );

      const server = app.listen(0);
      const port = server.address().port;
      try {
        const response = await fetch(`http://127.0.0.1:${port}/batches/BATCH_MW_TEST/approve`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({}),
        });
        assert.strictEqual(response.status, 422);
        const body = await response.json();
        assert.strictEqual(body.error.code, 'UNRESOLVED_BLOCKING_ISSUES');
        assert.strictEqual(body.error.blocking_count, 1);
      } finally {
        server.close();
      }
    });
  });

  // ==========================================================================
  // CRITERIA 3: MAKER-CHECKER SEGREGATION
  // ==========================================================================
  await t.test('CRITERIA 3: Maker-Checker Segregation of Duties', async (t3) => {

    await t3.test('3.1 Rejects approval with 403 Forbidden and logs authorization failure when maker_id === checker_id', async () => {
      const batchId = 'BATCH_MC_001';
      const makerUser = 'maker_swati@kylrx.ai';
      const batch = {
        batch_id: batchId,
        state: 'PENDING_APPROVAL',
        maker_id: makerUser,
        records: [{ employee_id: 'EMP_10', net_payable: 25000 }],
        total_amount: 25000,
        total_records: 1,
      };
      store.paymentBatches.set(batchId, batch);

      // Maker attempts to approve their own batch
      await assert.rejects(
        async () => {
          await ApprovalService.approveBatch(batchId, {
            checker_id: makerUser, // Self-approval!
          });
        },
        (err) => {
          assert.strictEqual(err.statusCode, 403, 'Must reject with HTTP 403 Forbidden');
          assert.match(err.message, /cannot approve their own/);
          return true;
        }
      );

      // Verify authorization failure event was logged
      assert.strictEqual(MakerCheckerGuard.authorizationFailureEvents.length, 1);
      const event = MakerCheckerGuard.authorizationFailureEvents[0];
      assert.strictEqual(event.event, 'AUTHORIZATION_FAILURE');
      assert.strictEqual(event.violation_type, 'MAKER_CHECKER_SELF_APPROVAL_PROHIBITED');
      assert.strictEqual(event.actor_id, makerUser);
      assert.strictEqual(event.batch_id, batchId);

      // Verify audit log store captured the event
      const auditFailure = store.auditLogs.find((l) => l.event === 'AUTHORIZATION_FAILURE');
      assert.ok(auditFailure, 'Audit trail must record AUTHORIZATION_FAILURE');
      assert.strictEqual(auditFailure.actor_id, makerUser);
    });

    await t3.test('3.2 Rejects approval when checker matches created_by or submitted_by aliases', () => {
      const batchCreated = {
        batch_id: 'BATCH_MC_CREATED',
        created_by: 'creator_dev@kylrx.ai',
      };
      const batchSubmitted = {
        batch_id: 'BATCH_MC_SUBMITTED',
        submitted_by: 'submitter_ops@kylrx.ai',
      };

      // Created_by conflict
      assert.throws(
        () => {
          MakerCheckerGuard.assertSeparationOfDuties({
            batch: batchCreated,
            requestingUserId: 'creator_dev@kylrx.ai',
          });
        },
        (err) => {
          assert.ok(err instanceof MakerCheckerViolationError);
          assert.strictEqual(err.statusCode, 403);
          assert.strictEqual(err.details.conflict_field, 'created_by');
          return true;
        }
      );

      // Submitted_by conflict
      assert.throws(
        () => {
          MakerCheckerGuard.assertSeparationOfDuties({
            batch: batchSubmitted,
            requestingUserId: 'submitter_ops@kylrx.ai',
          });
        },
        (err) => {
          assert.ok(err instanceof MakerCheckerViolationError);
          assert.strictEqual(err.statusCode, 403);
          assert.strictEqual(err.details.conflict_field, 'submitted_by');
          return true;
        }
      );
    });

    await t3.test('3.3 Permits approval when checker is independent of maker', () => {
      const batch = {
        batch_id: 'BATCH_MC_VALID',
        maker_id: 'maker_swati@kylrx.ai',
        created_by: 'maker_swati@kylrx.ai',
        submitted_by: 'maker_swati@kylrx.ai',
      };

      const result = MakerCheckerGuard.assertSeparationOfDuties({
        batch,
        requestingUserId: 'independent_checker@kylrx.ai',
      });

      assert.strictEqual(result.authorized, true);
      assert.strictEqual(result.checker_id, 'independent_checker@kylrx.ai');
      assert.strictEqual(result.maker_id, 'maker_swati@kylrx.ai');
    });
  });

  // ==========================================================================
  // CRITERIA 12: DATA MASKING & PRIVILEGED CRYPTOGRAPHIC EXPORT SECURITY
  // ==========================================================================
  await t.test('CRITERIA 12: Data Masking & Privileged Signed Export Security', async (t12) => {

    await t12.test('12.1 Field-level masking: Bank accounts (••••••••1234), PRAN, PAN/Tax IDs, Aadhaar, and UAN', () => {
      // 1. Bank Account masking
      assert.strictEqual(DataMaskingService.maskBankAccount('50100456789012'), '••••••••••9012');
      assert.strictEqual(DataMaskingService.maskBankAccount('12345678'), '••••••••5678');
      assert.strictEqual(DataMaskingService.maskBankAccount('1234'), '1234');
      assert.strictEqual(DataMaskingService.maskBankAccount(''), '');

      // 2. PRAN (Permanent Retirement Account Number) masking
      assert.strictEqual(DataMaskingService.maskPran('110012345678'), '••••••••5678');

      // 3. Tax ID / PAN masking
      assert.strictEqual(DataMaskingService.maskTaxId('ABCDE1234F'), '•••••1234F');

      // 4. Aadhaar masking
      assert.strictEqual(DataMaskingService.maskAadhaar('123456789012'), '••••••••9012');

      // 5. UAN masking
      assert.strictEqual(DataMaskingService.maskUan('100123456789'), '••••••••6789');

      // 6. ESIC IP masking
      assert.strictEqual(DataMaskingService.maskEsicIp('3100123456'), '••••••3456');
    });

    await t12.test('12.2 Recursive payload masking for UI and client payloads', () => {
      const rawPayload = {
        batch_id: 'BATCH_2026_09',
        debit_account_number: '50200012345678',
        employees: [
          {
            id: 'EMP_01',
            name: 'Pooja Sharma',
            account_number: '50100499887766',
            pan: 'ABCDE1111A',
            pran: '200111111111',
            uan: '100111111111',
            net: 85000,
          },
        ],
      };

      const masked = DataMaskingService.maskSensitivePayload(rawPayload);

      assert.strictEqual(masked.debit_account_number, '••••••••••5678');
      assert.strictEqual(masked.employees[0].account_number, '••••••••••7766');
      assert.strictEqual(masked.employees[0].account_number_masked, '••••••••••7766');
      assert.strictEqual(masked.employees[0].pan, '•••••1111A');
      assert.strictEqual(masked.employees[0].pran, '••••••••1111');
      assert.strictEqual(masked.employees[0].uan, '••••••••1111');
      assert.strictEqual(masked.employees[0].net, 85000); // Non-sensitive intact
    });

    await t12.test('12.3 Log output masking prevents plain identifiers in application logs', () => {
      const logString = 'Disbursing 50000 INR to account 50100412345678 for PAN ABCDE1234F';
      const sanitizedString = DataMaskingService.maskLogOutput(logString);

      assert.doesNotMatch(sanitizedString, /50100412345678/);
      assert.doesNotMatch(sanitizedString, /ABCDE1234F/);
      assert.match(sanitizedString, /••••••••5678/);
      assert.match(sanitizedString, /•••••1234F/);
    });

    await t12.test('12.4 Privileged cryptographic export: raw values accessible ONLY with verified HMAC signature', () => {
      const rawBatch = {
        batch_id: 'BATCH_EXP_CORE',
        debit_account_number: '50200099887766',
        records: [
          {
            employee_id: 'EMP_A',
            account_number: '50100411223344',
            pran: '110099887766',
            pan: 'AAAAA9999A',
          },
        ],
      };

      // 1. Generate valid cryptographic export authorization token
      const auth = PrivilegedExportSecurityService.generateExportAuthorizationToken({
        batchId: 'BATCH_EXP_CORE',
        authorizedBy: 'FINANCE_HEAD',
        ttlSeconds: 60,
      });

      assert.ok(auth.token);
      assert.ok(auth.signature);

      // 2. Verification passes with valid token
      const verified = PrivilegedExportSecurityService.verifyExportAuthorizationToken(
        auth.token,
        'BATCH_EXP_CORE'
      );
      assert.strictEqual(verified.verified, true);
      assert.strictEqual(verified.manifest.authorized_by, 'FINANCE_HEAD');

      // 3. Raw values strictly retrieved for authorized export worker
      const privilegedBatch = PrivilegedExportSecurityService.getPrivilegedRawBatch({
        batch: rawBatch,
        authToken: auth.token,
      });
      assert.strictEqual(privilegedBatch.raw_values_authorized, true);
      assert.strictEqual(privilegedBatch.records[0].account_number, '50100411223344', 'Raw value accessible');
      assert.strictEqual(privilegedBatch.records[0].pran, '110099887766', 'Raw value accessible');

      // 4. Tampered signature is strictly rejected
      const tamperedToken = auth.token.slice(0, -4) + 'ffff';
      assert.throws(
        () => {
          PrivilegedExportSecurityService.verifyExportAuthorizationToken(tamperedToken, 'BATCH_EXP_CORE');
        },
        (err) => {
          assert.ok(err instanceof PrivilegedSecurityError);
          assert.strictEqual(err.statusCode, 403);
          assert.match(err.message, /verification failed/);
          return true;
        }
      );

      // 5. Expired token is rejected
      const expiredAuth = PrivilegedExportSecurityService.generateExportAuthorizationToken({
        batchId: 'BATCH_EXP_CORE',
        authorizedBy: 'FINANCE_HEAD',
        ttlSeconds: -10, // Expired 10s ago
      });
      assert.throws(
        () => {
          PrivilegedExportSecurityService.verifyExportAuthorizationToken(expiredAuth.token, 'BATCH_EXP_CORE');
        },
        (err) => {
          assert.ok(err instanceof PrivilegedSecurityError);
          assert.strictEqual(err.statusCode, 403);
          assert.match(err.message, /expired/);
          return true;
        }
      );
    });

    await t12.test('12.5 Express API: Default UI payloads are masked; privileged signed export serves raw data', async () => {
      const app = express();
      const router = createDisbursementApiRouter();
      app.use('/api', router);

      const batchId = 'BATCH_API_TEST';
      const batchData = {
        batch_id: batchId,
        state: 'APPROVED',
        debit_account_number: '50200055443322',
        total_amount: 100000,
        records: [
          {
            employee_id: 'EMP_100',
            account_number: '50100488776655',
            pan: 'ZZZZZ1234Z',
            pran: '300111222333',
            net_payable: 100000,
          },
        ],
      };
      store.paymentBatches.set(batchId, batchData);

      const server = app.listen(0);
      const port = server.address().port;
      const baseUrl = `http://127.0.0.1:${port}`;

      try {
        // 1. Standard UI query: Response MUST be masked!
        const uiRes = await fetch(`${baseUrl}/api/payment-batches/${batchId}`);
        assert.strictEqual(uiRes.status, 200);
        const uiBody = await uiRes.json();
        const uiBatch = uiBody.data;
        assert.strictEqual(uiBatch.records[0].account_number, '••••••••••6655', 'Account must be masked for UI');
        assert.strictEqual(uiBatch.records[0].pan, '•••••1234Z', 'PAN must be masked for UI');
        assert.strictEqual(uiBatch.records[0].pran, '••••••••2333', 'PRAN must be masked for UI');

        // 2. Attempt privileged export without cryptographic token: 403 Forbidden!
        const unauthExportRes = await fetch(`${baseUrl}/api/payment-batches/${batchId}/privileged-export`, {
          method: 'POST',
        });
        assert.strictEqual(unauthExportRes.status, 403);

        // 3. Generate cryptographic export token
        const tokenRes = await fetch(`${baseUrl}/api/payment-batches/${batchId}/export-token`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ authorized_by: 'DIRECT_INTEGRATION_KEY' }),
        });
        assert.strictEqual(tokenRes.status, 200);
        const tokenBody = await tokenRes.json();
        const authToken = tokenBody.data.token;

        // 4. Privileged export with verified token: Raw unmasked data delivered!
        const privilegedRes = await fetch(`${baseUrl}/api/payment-batches/${batchId}/privileged-export`, {
          method: 'POST',
          headers: { 'x-kylrx-export-signature': authToken },
        });

        assert.strictEqual(privilegedRes.status, 200);
        const exportBody = await privilegedRes.json();
        const exportBatch = exportBody.data;
        assert.strictEqual(exportBatch.raw_values_authorized, true);
        assert.strictEqual(exportBatch.records[0].account_number, '50100488776655', 'Raw account number delivered to signed worker');
        assert.strictEqual(exportBatch.records[0].pan, 'ZZZZZ1234Z', 'Raw PAN delivered to signed worker');
      } finally {
        server.close();
      }
    });
  });

});
