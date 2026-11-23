/**
 * ============================================================================
 * KYLRX.AI ENTERPRISE HRMS - PAYROLL & DECENTRO FABRIC INTEGRATION TEST SUITE
 * ============================================================================
 * Strictly Adhering to PRD Section 4 and Templates.xlsx schema:
 * 
 * 1. Strict Separation of Concerns:
 *    - Validates PayrollDocumentService has zero banking/disbursement logic
 *    - Validates PayrollDisbursementService has zero document rendering logic
 *    - Verifies document generation and payout disbursement run independently
 * 2. Decentro Fabric Banking Integration:
 *    - Multi-channel payouts (IMPS, NEFT, RTGS) via staging gateway
 * 3. Beneficiary Details Sourcing:
 *    - Ingests 'Employee Finance Deatils' sheet schema (Account_Holder_Name,
 *      Bank_Name, Account_Number, IFSC, Account_Type, Is_Primary)
 * 4. 4-Eyes Maker-Checker Authorization:
 *    - Blocks self-approval (checkerId === makerId)
 *    - Enforces distinct checker approval prior to execution
 * 5. Asynchronous Webhook Reconciler & Idempotency:
 *    - Idempotent Firestore reconciliation for SUCCESS, PENDING, FAILURE
 * 6. Safe Chunking & Exponential Backoff:
 *    - 400-operation chunking guard and retry recovery
 * 7. Customer-Templated Outputs:
 *    - Excel (.xlsx) register via SheetJS
 *    - PDF (.pdf) payslip with corporate branding
 * ============================================================================
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';
import crypto from 'crypto';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
process.env.NODE_ENV = 'test';

const { PayrollDocumentService, DEFAULT_PAYROLL_COMPONENTS } = require('../services/payroll/payrollDocumentService.js');
const { PayrollDisbursementService, MakerCheckerViolationError } = require('../services/payroll/payrollDisbursementService.js');

describe('Kylrx.ai Payroll Management & Cashfree Payouts Integration (PRD §4)', () => {

  // ──────────────────────────────────────────────────────────────────────────
  // 1. STRICT SEPARATION OF CONCERNS (PRD SECTION 4)
  // ──────────────────────────────────────────────────────────────────────────
  describe('1. Strict Separation of Concerns Architecture', () => {
    it('1.1 PayrollDocumentService must have zero banking, payout, or disbursement methods', () => {
      const docService = new PayrollDocumentService();
      const forbiddenTerms = [
        'disburse', 'payout', 'cashfree', 'bankTransfer', 'utr', 'imps', 'neft', 'rtgs', 'makerChecker'
      ];

      for (const term of forbiddenTerms) {
        assert.strictEqual(
          typeof docService[term],
          'undefined',
          `Violation: PayrollDocumentService contains forbidden banking method '${term}'`
        );
      }

      // Must have pure document methods
      assert.strictEqual(typeof docService.generatePayslipDocument, 'function');
      assert.strictEqual(typeof docService.generateMonthlyBatch, 'function');
      assert.strictEqual(typeof docService.generatePayrollRegisterExcel, 'function');
      assert.strictEqual(typeof docService.generatePayslipPdf, 'function');
    });

    it('1.2 PayrollDisbursementService must have zero document rendering, HTML, or PDF methods', () => {
      const disbService = new PayrollDisbursementService();
      const forbiddenTerms = [
        'generatePayslip', 'generatePdf', 'generateExcel', 'renderHtml', 'payslipTemplate', 'sheetJs'
      ];

      for (const term of forbiddenTerms) {
        assert.strictEqual(
          typeof disbService[term],
          'undefined',
          `Violation: PayrollDisbursementService contains forbidden document method '${term}'`
        );
      }

      // Must have pure disbursement and banking methods
      assert.strictEqual(typeof disbService.createDisbursementBatch, 'function');
      assert.strictEqual(typeof disbService.approveDisbursementBatch, 'function');
      assert.strictEqual(typeof disbService.executeCashfreePayoutBatch, 'function');
      assert.strictEqual(typeof disbService.handleCashfreeWebhook, 'function');
      assert.strictEqual(typeof disbService.reconcilePendingTransfers, 'function');
    });

    it('1.3 Document generation runs independently without triggering or requiring disbursement', async () => {
      const docService = new PayrollDocumentService();
      const employee = {
        id: 'EMP_TEST_01',
        employeeCode: 'EMP0001',
        name: 'Aditi Rao',
        grossSalary: 60000,
        department: 'Engineering'
      };

      const result = await docService.generatePayslipDocument(employee, 'October 2026');
      assert.strictEqual(result.success, true);
      assert.ok(result.docId.startsWith('PAY-EMP_TEST_01'));
      assert.strictEqual(result.documentRecord.status, 'Generated');
      assert.strictEqual(result.documentRecord.grossSalary, 60000);
      assert.ok(result.documentRecord.netPay > 0);
      // Verify no payment/disbursement fields were injected
      assert.strictEqual(result.documentRecord.utr, undefined);
      assert.strictEqual(result.documentRecord.decentroTxnId, undefined);
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // 2. BENEFICIARY DETAILS SOURCING ('Employee Finance Deatils' Schema)
  // ──────────────────────────────────────────────────────────────────────────
  describe('2. Beneficiary Details Sourcing & Validation', () => {
    const disbService = new PayrollDisbursementService();

    it('2.1 Correctly extracts and validates compliant beneficiary details from schema', () => {
      const rawFinanceData = {
        Account_Holder_Name: 'Vikramaditya Sharma',
        Bank_Name: 'HDFC Bank',
        Account_Number: '50100234567890',
        IFSC: 'HDFC0001234',
        Account_Type: 'SAVINGS',
        Is_Primary: 'Yes'
      };

      const extracted = disbService.extractBeneficiaryDetails(rawFinanceData);
      assert.strictEqual(extracted.isValid, true);
      assert.strictEqual(extracted.errors.length, 0);
      assert.strictEqual(extracted.beneficiary.Account_Holder_Name, 'Vikramaditya Sharma');
      assert.strictEqual(extracted.beneficiary.Bank_Name, 'HDFC Bank');
      assert.strictEqual(extracted.beneficiary.Account_Number, '50100234567890');
      assert.strictEqual(extracted.beneficiary.IFSC, 'HDFC0001234');
      assert.strictEqual(extracted.beneficiary.Account_Type, 'SAVINGS');
      assert.strictEqual(extracted.beneficiary.Is_Primary, true);
    });

    it('2.2 Rejects malformed IFSC or missing mandatory account number', () => {
      const invalidFinanceData = {
        Account_Holder_Name: 'Test Employee',
        Bank_Name: 'SBI',
        Account_Number: '', // missing
        IFSC: 'INVALID_IFSC_123',
        Account_Type: 'CURRENT',
        Is_Primary: 'No'
      };

      const extracted = disbService.extractBeneficiaryDetails(invalidFinanceData);
      assert.strictEqual(extracted.isValid, false);
      assert.ok(extracted.errors.length >= 2);
      assert.ok(extracted.errors.some(e => e.includes('Account_Number')));
      assert.ok(extracted.errors.some(e => e.includes('IFSC')));
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // 3. 4-EYES MAKER-CHECKER AUTHORIZATION GATE
  // ──────────────────────────────────────────────────────────────────────────
  describe('3. 4-Eyes Maker-Checker Authorization Gate', () => {
    it('3.1 Creates payout batch in PENDING_APPROVAL status with maker record', async () => {
      const disbService = new PayrollDisbursementService();
      const batch = await disbService.createDisbursementBatch({
        batchId: 'BATCH_TEST_001',
        period: 'September 2026',
        makerId: 'ADMIN_MAKER_01',
        payoutChannel: 'IMPS',
        employees: [
          {
            id: 'EMP_01',
            name: 'Prakash Padukone',
            netPayable: 45000,
            financeDetails: {
              Account_Holder_Name: 'Prakash Padukone',
              Bank_Name: 'ICICI Bank',
              Account_Number: '001102233445',
              IFSC: 'ICIC0000011',
              Account_Type: 'SAVINGS',
              Is_Primary: true
            }
          }
        ]
      });

      assert.strictEqual(batch.batchId, 'BATCH_TEST_001');
      assert.strictEqual(batch.status, 'PENDING_APPROVAL');
      assert.strictEqual(batch.maker.makerId, 'ADMIN_MAKER_01');
      assert.strictEqual(batch.checker, null);
      assert.strictEqual(batch.summary.totalRecords, 1);
      assert.strictEqual(batch.summary.totalAmount, 45000);
    });

    it('3.2 Strict 4-Eyes: BLOCKS approval when Maker attempts to self-approve', async () => {
      const disbService = new PayrollDisbursementService();
      await disbService.createDisbursementBatch({
        batchId: 'BATCH_SELF_APPROVE_TEST',
        makerId: 'ADMIN_MAKER_01',
        employees: []
      });

      // Maker tries to approve their own batch
      await assert.rejects(
        async () => {
          await disbService.approveDisbursementBatch('BATCH_SELF_APPROVE_TEST', 'ADMIN_MAKER_01');
        },
        (err) => {
          assert.strictEqual(err.name, 'MakerCheckerViolationError');
          assert.strictEqual(err.statusCode, 403);
          assert.ok(err.message.includes('4-Eyes Violation'));
          return true;
        }
      );
    });

    it('3.3 Allows approval by distinct Checker and transitions status to APPROVED', async () => {
      const disbService = new PayrollDisbursementService();
      await disbService.createDisbursementBatch({
        batchId: 'BATCH_VALID_APPROVAL_TEST',
        makerId: 'ADMIN_MAKER_01',
        employees: []
      });

      const approval = await disbService.approveDisbursementBatch('BATCH_VALID_APPROVAL_TEST', 'ADMIN_CHECKER_02');
      assert.strictEqual(approval.success, true);
      assert.strictEqual(approval.status, 'APPROVED');
      assert.strictEqual(approval.approvedBy, 'ADMIN_CHECKER_02');
      assert.strictEqual(approval.batch.checker.checkerId, 'ADMIN_CHECKER_02');
    });

    it('3.4 BLOCKS Cashfree execution if batch is not APPROVED', async () => {
      const disbService = new PayrollDisbursementService();
      await disbService.createDisbursementBatch({
        batchId: 'BATCH_UNAPPROVED_EXEC_TEST',
        makerId: 'ADMIN_MAKER_01',
        employees: []
      });

      // Batch is still PENDING_APPROVAL
      await assert.rejects(
        async () => {
          await disbService.executeCashfreePayoutBatch('BATCH_UNAPPROVED_EXEC_TEST');
        },
        (err) => {
          assert.strictEqual(err.name, 'MakerCheckerViolationError');
          assert.ok(err.message.includes('cannot be disbursed'));
          return true;
        }
      );
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // 4. CASHFREE PAYOUTS INTEGRATION & BATCH EXECUTION
  // ──────────────────────────────────────────────────────────────────────────
  describe('4. Cashfree Payouts API Integration & Dispatch', () => {
    // Fake gateway: records every call so we can assert idempotency / retry semantics.
    function makeFakeProvider(overrides = {}) {
      const calls = { beneficiaries: [], transfers: [], statusChecks: [] };
      return {
        apiVersion: 'v2', environment: 'sandbox', calls,
        async getBalance() { return { availableBalance: overrides.balance !== undefined ? overrides.balance : 10000000 }; },
        async ensureBeneficiary(b) { calls.beneficiaries.push(b); return { beneficiaryId: b.beneficiaryId, created: true }; },
        async createTransfer(t) {
          calls.transfers.push(t);
          if (overrides.failWith) throw overrides.failWith;
          return { transferId: t.transferId, providerReferenceId: 'CF_' + t.transferId, status: overrides.status || 'PENDING', utr: null, message: null };
        },
        async getTransferStatus(id) { calls.statusChecks.push(id); return { transferId: id, providerReferenceId: 'CF_' + id, status: overrides.pollStatus || 'SUCCESS', utr: 'UTR_POLLED_123', message: null }; },
        verifyWebhookSignature() { return true; }
      };
    }

    it('4.1 Dispatches approved batch to Cashfree with deterministic, idempotent transfer ids', async () => {
      const provider = makeFakeProvider();
      const disbService = new PayrollDisbursementService({ provider, db: null });
      await disbService.createDisbursementBatch({
        batchId: 'BATCH_CF_DISPATCH', makerId: 'MAKER_101', payoutChannel: 'IMPS',
        employees: [
          {
            id: 'EMP_101', name: 'Sunil Gavaskar', netPayable: 75000,
            financeDetails: { Account_Holder_Name: 'Sunil Gavaskar', Bank_Name: 'Axis Bank', Account_Number: '912010012345678', IFSC: 'UTIB0000123', Account_Type: 'SAVINGS', Is_Primary: true }
          },
          {
            id: 'EMP_102', name: 'Kapil Dev', netPayable: 80000,
            financeDetails: { Account_Holder_Name: 'Kapil Dev', Bank_Name: 'Axis Bank', Account_Number: '50100987654321', IFSC: 'HDFC0000456', Account_Type: 'SAVINGS', Is_Primary: true }
          }
        ]
      });
      await disbService.approveDisbursementBatch('BATCH_CF_DISPATCH', 'CHECKER_202');

      const execResult = await disbService.executeCashfreePayoutBatch('BATCH_CF_DISPATCH');
      assert.strictEqual(execResult.success, true);
      assert.strictEqual(execResult.totalDispatched, 2);
      assert.ok(execResult.gateway.startsWith('Cashfree Payouts'));

      // Every employee is registered as a beneficiary before their transfer
      assert.strictEqual(provider.calls.beneficiaries.length, 2);
      // Transfer ids are deterministic (batch + employee), which is what makes retries safe
      const ids = provider.calls.transfers.map(t => t.transferId).sort();
      assert.deepStrictEqual(ids, ['BATCH_CF_DISPATCH-EMP_101', 'BATCH_CF_DISPATCH-EMP_102']);

      const updated = await disbService.getBatch('BATCH_CF_DISPATCH');
      assert.strictEqual(updated.records[0].cashfreeTransferId, 'BATCH_CF_DISPATCH-EMP_101');
      assert.strictEqual(updated.status, 'DISBURSING');
    });

    it('4.2 A re-run reuses the SAME transfer id, so an employee can never be paid twice', async () => {
      const provider = makeFakeProvider();
      const disbService = new PayrollDisbursementService({ provider, db: null });
      await disbService.createDisbursementBatch({
        batchId: 'BATCH_CF_IDEMP', makerId: 'M1', employees: [
          {
            id: 'EMP_201', name: 'Anil Kumble', netPayable: 50000,
            financeDetails: { Account_Holder_Name: 'Anil Kumble', Bank_Name: 'Axis Bank', Account_Number: '1234567890', IFSC: 'SBIN0001234', Account_Type: 'SAVINGS', Is_Primary: true }
          }
        ]
      });
      await disbService.approveDisbursementBatch('BATCH_CF_IDEMP', 'C1');
      await disbService.executeCashfreePayoutBatch('BATCH_CF_IDEMP');
      const firstId = provider.calls.transfers[0].transferId;

      // Force a second dispatch of the same batch
      const batch = await disbService.getBatch('BATCH_CF_IDEMP');
      batch.status = 'APPROVED';
      await disbService.executeCashfreePayoutBatch('BATCH_CF_IDEMP');

      assert.strictEqual(provider.calls.transfers.length, 2, 'two API calls were made');
      assert.strictEqual(provider.calls.transfers[1].transferId, firstId,
        'the SECOND call reused the same transfer id — Cashfree de-duplicates, so no double payment');
    });

    it('4.3 Does NOT retry a business rejection (only transient faults are retried)', async () => {
      const nonRetryable = Object.assign(new Error('Invalid beneficiary account'), { retryable: false, statusCode: 400 });
      const provider = makeFakeProvider({ failWith: nonRetryable });
      const disbService = new PayrollDisbursementService({ provider, db: null });
      await disbService.createDisbursementBatch({
        batchId: 'BATCH_CF_NORETRY', makerId: 'M1', employees: [
          {
            id: 'EMP_301', name: 'Zaheer Khan', netPayable: 40000,
            financeDetails: { Account_Holder_Name: 'Zaheer Khan', Bank_Name: 'Axis Bank', Account_Number: '999988887777', IFSC: 'ICIC0000111', Account_Type: 'SAVINGS', Is_Primary: true }
          }
        ]
      });
      await disbService.approveDisbursementBatch('BATCH_CF_NORETRY', 'C1');
      const res = await disbService.executeCashfreePayoutBatch('BATCH_CF_NORETRY');

      assert.strictEqual(provider.calls.transfers.length, 1, 'a 4xx business rejection must not be retried');
      assert.strictEqual(res.failed, 1);
      const b = await disbService.getBatch('BATCH_CF_NORETRY');
      assert.strictEqual(b.records[0].status, 'FAILURE');
      assert.ok(b.records[0].failureReason.includes('Invalid beneficiary'));
    });

    it('4.4 Blocks the whole batch when the Cashfree balance cannot cover it (no part-paid payroll)', async () => {
      const provider = makeFakeProvider({ balance: 100 });
      const disbService = new PayrollDisbursementService({ provider, db: null });
      await disbService.createDisbursementBatch({
        batchId: 'BATCH_CF_BALANCE', makerId: 'M1', employees: [
          {
            id: 'EMP_401', name: 'Virat K', netPayable: 90000,
            financeDetails: { Account_Holder_Name: 'Virat K', Bank_Name: 'Axis Bank', Account_Number: '111122223333', IFSC: 'HDFC0000999', Account_Type: 'SAVINGS', Is_Primary: true }
          }
        ]
      });
      await disbService.approveDisbursementBatch('BATCH_CF_BALANCE', 'C1');
      await assert.rejects(
        () => disbService.executeCashfreePayoutBatch('BATCH_CF_BALANCE'),
        (err) => { assert.strictEqual(err.name, 'PayoutValidationError'); assert.ok(/Insufficient Cashfree balance/.test(err.message)); return true; }
      );
      assert.strictEqual(provider.calls.transfers.length, 0, 'nothing was debited');
    });

    it('4.5 Polling fallback settles a PENDING transfer when a webhook never arrives', async () => {
      const provider = makeFakeProvider({ status: 'PENDING', pollStatus: 'SUCCESS' });
      const disbService = new PayrollDisbursementService({ provider, db: null });
      await disbService.createDisbursementBatch({
        batchId: 'BATCH_CF_POLL', makerId: 'M1', employees: [
          {
            id: 'EMP_501', name: 'Jasprit B', netPayable: 55000,
            financeDetails: { Account_Holder_Name: 'Jasprit B', Bank_Name: 'Axis Bank', Account_Number: '444455556666', IFSC: 'UTIB0000777', Account_Type: 'SAVINGS', Is_Primary: true }
          }
        ]
      });
      await disbService.approveDisbursementBatch('BATCH_CF_POLL', 'C1');
      await disbService.executeCashfreePayoutBatch('BATCH_CF_POLL');

      const result = await disbService.reconcilePendingTransfers('BATCH_CF_POLL');
      assert.strictEqual(result.updated, 1);
      assert.strictEqual(result.status, 'DISBURSED');
      const b = await disbService.getBatch('BATCH_CF_POLL');
      assert.strictEqual(b.records[0].status, 'SUCCESS');
      assert.strictEqual(b.records[0].utr, 'UTR_POLLED_123');
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // 5. SIGNED CASHFREE WEBHOOKS & IDEMPOTENT RECONCILIATION
  // ──────────────────────────────────────────────────────────────────────────
  describe('5. Cashfree Webhook Callback & Idempotent Reconciliation', () => {
    const SECRET = 'test_webhook_secret';
    function signedProvider() {
      return {
        apiVersion: 'v2', environment: 'sandbox',
        async getBalance() { return { availableBalance: 10000000 }; },
        async ensureBeneficiary(b) { return { beneficiaryId: b.beneficiaryId }; },
        async createTransfer(t) { return { transferId: t.transferId, providerReferenceId: 'CF_' + t.transferId, status: 'PENDING', utr: null }; },
        async getTransferStatus(id) { return { transferId: id, status: 'PENDING', utr: null }; },
        verifyWebhookSignature(rawBody, signature, timestamp) {
          const expected = crypto.createHmac('sha256', SECRET).update(String(timestamp || '') + rawBody).digest('base64');
          return signature === expected;
        }
      };
    }
    async function seedDispatched(batchId) {
      const disbService = new PayrollDisbursementService({ provider: signedProvider(), db: null, requireWebhookSignature: true });
      await disbService.createDisbursementBatch({
        batchId, makerId: 'MAKER_101', employees: [
          {
            id: 'EMP_WH_1', name: 'Rahul Dravid', netPayable: 62000,
            financeDetails: { Account_Holder_Name: 'Rahul Dravid', Bank_Name: 'Axis Bank', Account_Number: '30012345678', IFSC: 'SBIN0001234', Account_Type: 'SAVINGS', Is_Primary: true }
          }
        ]
      });
      await disbService.approveDisbursementBatch(batchId, 'CHECKER_202');
      await disbService.executeCashfreePayoutBatch(batchId);
      return disbService;
    }
    const bodyFor = (transferId, status, utr) => JSON.stringify({
      type: 'TRANSFER_STATUS',
      data: { transfer: { transfer_id: transferId, transfer_status: status, transfer_utr: utr, cf_transfer_id: 'CF_1' } }
    });

    it('5.1 Verified webhook reconciles to SUCCESS, assigns UTR, and a replay is idempotent', async () => {
      const svc = await seedDispatched('BATCH_WEBHOOK_TEST');
      const transferId = 'BATCH_WEBHOOK_TEST-EMP_WH_1';
      const rawBody = bodyFor(transferId, 'SUCCESS', 'UTR_CF_99887766');
      const timestamp = '1700000000';
      const signature = crypto.createHmac('sha256', SECRET).update(timestamp + rawBody).digest('base64');

      const first = await svc.handleCashfreeWebhook({ rawBody, signature, timestamp });
      assert.strictEqual(first.success, true);
      assert.strictEqual(first.idempotent, false);
      assert.strictEqual(first.reconciledStatus, 'SUCCESS');
      assert.strictEqual(first.reconciledRecord.utr, 'UTR_CF_99887766');
      assert.strictEqual((await svc.getBatch('BATCH_WEBHOOK_TEST')).status, 'DISBURSED');

      const replay = await svc.handleCashfreeWebhook({ rawBody, signature, timestamp });
      assert.strictEqual(replay.idempotent, true);
      assert.ok(replay.message.includes('already processed'));
    });

    it('5.2 REJECTS a forged or unsigned webhook (a fake SUCCESS cannot mark payroll paid)', async () => {
      const svc = await seedDispatched('BATCH_WEBHOOK_FORGED');
      const transferId = 'BATCH_WEBHOOK_FORGED-EMP_WH_1';
      const rawBody = bodyFor(transferId, 'SUCCESS', 'UTR_FAKE');

      await assert.rejects(
        () => svc.handleCashfreeWebhook({ rawBody, signature: 'not-a-real-signature', timestamp: '1700000000' }),
        (err) => { assert.strictEqual(err.name, 'PayoutValidationError'); assert.ok(/signature/i.test(err.message)); return true; }
      );
      await assert.rejects(() => svc.handleCashfreeWebhook({ rawBody, timestamp: '1700000000' }));

      // State untouched by the forgery attempt
      const b = await svc.getBatch('BATCH_WEBHOOK_FORGED');
      assert.strictEqual(b.records[0].status, 'PENDING');
      assert.notStrictEqual(b.status, 'DISBURSED');
    });

    it('5.3 A late PENDING delivery never regresses an already-settled payment', async () => {
      const svc = await seedDispatched('BATCH_WEBHOOK_ORDER');
      const transferId = 'BATCH_WEBHOOK_ORDER-EMP_WH_1';
      const sign = (raw, ts) => crypto.createHmac('sha256', SECRET).update(ts + raw).digest('base64');

      const okBody = bodyFor(transferId, 'SUCCESS', 'UTR_FINAL');
      await svc.handleCashfreeWebhook({ rawBody: okBody, signature: sign(okBody, '1'), timestamp: '1' });

      const lateBody = bodyFor(transferId, 'PENDING', null);
      await svc.handleCashfreeWebhook({ rawBody: lateBody, signature: sign(lateBody, '2'), timestamp: '2' });

      const b = await svc.getBatch('BATCH_WEBHOOK_ORDER');
      assert.strictEqual(b.records[0].status, 'SUCCESS', 'settled payment must not fall back to PENDING');
      assert.strictEqual(b.records[0].utr, 'UTR_FINAL');
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // 6. CUSTOMER-TEMPLATED OUTPUT GENERATORS (EXCEL & PDF)
  // ──────────────────────────────────────────────────────────────────────────
  describe('6. Customer-Templated Excel (.xlsx) & PDF (.pdf) Output Generators', () => {
    const docService = new PayrollDocumentService();

    it('6.1 Generates SheetJS Excel register conforming to Payroll Components schema', () => {
      const sampleRecords = [
        {
          employeeCode: 'EMP0001',
          employeeName: 'Prakash Padukone',
          department: 'Operations',
          designation: 'Operations Lead',
          salary: 50000
        },
        {
          employeeCode: 'EMP0002',
          employeeName: 'Sunil Gavaskar',
          department: 'Marketing',
          designation: 'Growth Manager',
          salary: 75000
        }
      ];

      const excelExport = docService.generatePayrollRegisterExcel(sampleRecords, 'September 2026');
      assert.ok(excelExport.fileName.includes('Monthly_Payroll_Register_September_2026.xlsx'));
      assert.strictEqual(excelExport.mimeType, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      assert.ok(Buffer.isBuffer(excelExport.buffer));
      assert.ok(excelExport.buffer.length > 500);
      assert.strictEqual(excelExport.rowCount, 2);
    });

    it('6.2 Generates customer-templated PDF payslip matching corporate branding', () => {
      const employeeDoc = {
        employeeCode: 'EMP0001',
        employeeName: 'Prakash Padukone',
        department: 'Operations',
        period: 'September 2026',
        financials: docService.calculateComponentBreakdown({ grossSalary: 50000 })
      };

      const pdfExport = docService.generatePayslipPdf(employeeDoc);
      assert.strictEqual(pdfExport.fileName, 'Payslip_EMP0001_September_2026.pdf');
      assert.strictEqual(pdfExport.mimeType, 'application/pdf');
      assert.ok(Buffer.isBuffer(pdfExport.buffer));
      const rawPdf = pdfExport.buffer.toString('utf-8');
      assert.ok(rawPdf.startsWith('%PDF-1.4'));
      assert.ok(rawPdf.includes('KYLRX.AI ENTERPRISE HRMS - OFFICIAL PAYSLIP'));
      assert.ok(rawPdf.includes('Prakash Padukone'));
      assert.ok(rawPdf.includes('EMP0001'));
    });
  });

});
