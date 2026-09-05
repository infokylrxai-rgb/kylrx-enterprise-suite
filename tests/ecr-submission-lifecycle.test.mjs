/**
 * ============================================================================
 * KYLRX AI ENTERPRISE HRMS - ECR GENERATION & SUBMISSION LIFECYCLE TEST SUITE
 * ============================================================================
 * Validates:
 * 1. Deterministic File Generation:
 *    - Ingestion of validated records ordered deterministically (pf_member_id ASC, uan ASC)
 *    - Consistent formatting using EPFO standard delimiter (#~#)
 * 2. Reproducibility & Cryptographic Hashing:
 *    - Direct linkage to frozen source payroll_run_id
 *    - SHA-256 file_hash computation
 *    - Persistence into ComplianceReturn (file_hash, generation_timestamp,
 *      row_count, total_wages, total_contributions)
 * 3. Idempotent Submission Pipeline:
 *    - Portal upload tracking
 *    - Idempotency gate (identical file_hash and run_id returns existing tracking record)
 *    - Duplicate batch prevention
 * 4. TRRN Tracking:
 *    - Ingestion of 13-digit TRRN, Challan Reference, and 15th statutory due date
 *    - State machine progression: GENERATED -> SUBMITTED -> CHALLAN_GENERATED
 *    - Audit event logging into compliance_audit_logs
 * 5. REST API Endpoints Integration
 *
 * @version 6.2.0
 * @author Kylrx AI Principal Backend Architect
 */

import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import express from 'express';

import {
  EcrSubmissionLifecycleService,
  globalEcrSubmissionLifecycleService,
  clearSubmissionTrackingStores,
  getSubmissionTrackingById,
  getSubmissionTrackingByRunId,
  TRRN_13_DIGIT_REGEX,
} from '../services/ecr-submission-lifecycle-service.mjs';

import {
  clearEcrComplianceReturns,
  getEcrComplianceReturnById,
} from '../services/ecr-formatting-file-generator.mjs';

import { globalComplianceAuditStream } from '../services/compliance-audit-logger.mjs';
import pfComplianceRouter from '../routes/pf-compliance.mjs';

describe('🚀 ECR File Generation & Submission Lifecycle Engine Tests', () => {
  let app;
  let server;
  let baseUrl;
  let service;

  before(async () => {
    app = express();
    app.use(express.json());
    app.use('/api/v1/pf', pfComplianceRouter);

    await new Promise((resolve) => {
      server = app.listen(0, () => {
        const port = server.address().port;
        baseUrl = `http://127.0.0.1:${port}/api/v1/pf`;
        resolve();
      });
    });
  });

  after(async () => {
    if (server) {
      await new Promise((resolve) => server.close(resolve));
    }
  });

  beforeEach(() => {
    clearSubmissionTrackingStores();
    clearEcrComplianceReturns();
    service = new EcrSubmissionLifecycleService();
  });

  // ==========================================================================
  // 1. DETERMINISTIC FILE GENERATION & ORDERING
  // ==========================================================================
  describe('1. Deterministic File Generation & Ordering', () => {
    const recordsUnsorted = [
      {
        employee: { uan: '100333333333', pf_member_id: 'MH/PUN/0099999/000/0000300', name: 'Zoya Khan', ncp_days: 0, refund: 0 },
        payroll: { gross_wages: 28000, epf_wages: 15000, eps_wages: 15000, edli_wages: 15000, employee_pf: 1800, eps: 1250, employer_pf: 550 },
      },
      {
        employee: { uan: '100111111111', pf_member_id: 'DL/CPM/0011111/000/0000100', name: 'Aarav Gupta', ncp_days: 1, refund: 0 },
        payroll: { gross_wages: 25000, epf_wages: 15000, eps_wages: 15000, edli_wages: 15000, employee_pf: 1800, eps: 1250, employer_pf: 550 },
      },
      {
        employee: { uan: '100222222222', pf_member_id: 'KN/BLR/0022222/000/0000200', name: 'Deepa Rao', ncp_days: 0, refund: 0 },
        payroll: { gross_wages: 20000, epf_wages: 15000, eps_wages: 15000, edli_wages: 15000, employee_pf: 1800, eps: 1250, employer_pf: 550 },
      },
    ];

    it('1.1 Should order rows deterministically by pf_member_id ASC regardless of input order', () => {
      const res1 = service.generateDeterministicEcrReturn({
        payroll_run_id: 'PR_FROZEN_2026_09_A',
        period: '2026-09',
        records: recordsUnsorted,
      });

      // Reverse the input order
      const recordsReversed = [...recordsUnsorted].reverse();
      const res2 = service.generateDeterministicEcrReturn({
        payroll_run_id: 'PR_FROZEN_2026_09_A',
        period: '2026-09',
        records: recordsReversed,
      });

      // Bit-for-bit file content equivalence
      assert.strictEqual(res1.content, res2.content);
      assert.strictEqual(res1.file_hash, res2.file_hash);

      const lines = res1.content.split('\r\n');
      assert.equal(lines.length, 3);
      // DL comes first, then KN, then MH
      assert.ok(lines[0].startsWith('100111111111#~#Aarav Gupta'));
      assert.ok(lines[1].startsWith('100222222222#~#Deepa Rao'));
      assert.ok(lines[2].startsWith('100333333333#~#Zoya Khan'));
    });

    it('1.2 Should format rows using EPFO delimiter standard (#~#)', () => {
      const res = service.generateDeterministicEcrReturn({
        payroll_run_id: 'PR_FROZEN_2026_09',
        period: '2026-09',
        records: [recordsUnsorted[0]],
      });

      const line = res.content.trim();
      const segments = line.split('#~#');
      assert.equal(segments.length, 11);
      assert.equal(segments[0], '100333333333');
      assert.equal(segments[1], 'Zoya Khan');
      assert.equal(segments[2], '28000'); // Gross
      assert.equal(segments[3], '15000'); // EPF wages
      assert.equal(segments[4], '15000'); // EPS wages
      assert.equal(segments[5], '15000'); // EDLI wages
      assert.equal(segments[6], '1800');  // EE share
      assert.equal(segments[7], '1250');  // EPS share
      assert.equal(segments[8], '550');   // ER share
      assert.equal(segments[9], '0');     // NCP days
      assert.equal(segments[10], '0');    // Refund
    });

    it('1.3 Should sanitize delimiter characters (# and ~) from member names', () => {
      const dirtyRecord = {
        employee: { uan: '100444444444', pf_member_id: 'DL/CPM/0000101', name: 'Rohan#~#Kumar~Verma' },
        payroll: { gross_wages: 20000, epf_wages: 15000 },
      };
      const res = service.generateDeterministicEcrReturn({
        payroll_run_id: 'PR_FROZEN_SANITY',
        period: '2026-09',
        records: [dirtyRecord],
      });

      const line = res.content.trim();
      assert.ok(!line.includes('Rohan#~#Kumar'));
      assert.ok(line.includes('RohanKumarVerma'));
    });
  });

  // ==========================================================================
  // 2. REPRODUCIBILITY & CRYPTOGRAPHIC HASHING
  // ==========================================================================
  describe('2. Reproducibility & Cryptographic Hashing', () => {
    it('2.1 Should require source payroll_run_id to link output file directly', () => {
      assert.throws(
        () => service.generateDeterministicEcrReturn({ period: '2026-09', records: [] }),
        /source payroll_run_id is required/
      );
    });

    it('2.2 Should compute SHA-256 hash of generated file and populate ComplianceReturn metadata', () => {
      const records = [
        {
          employee: { uan: '100555555555', pf_member_id: 'MH/12345/001', name: 'Manish Sisodia' },
          payroll: { gross_wages: 25000, epf_wages: 15000, employee_pf: 1800, eps: 1250, employer_pf: 550 },
        },
        {
          employee: { uan: '100666666666', pf_member_id: 'MH/12345/002', name: 'Pooja Hegde' },
          payroll: { gross_wages: 18000, epf_wages: 15000, employee_pf: 1800, eps: 1250, employer_pf: 550 },
        },
      ];

      const res = service.generateDeterministicEcrReturn({
        payroll_run_id: 'PR_RUN_SEPT_FROZEN_100',
        period: '2026-09',
        establishment_id: 'DLCPM0012345000',
        records,
      });

      // Verify SHA-256 hash
      const expectedHash = crypto.createHash('sha256').update(res.content, 'utf8').digest('hex');
      assert.equal(res.file_hash, expectedHash);
      assert.equal(res.file_hash.length, 64);

      // Verify ComplianceReturn entity metadata
      const cr = res.compliance_return;
      assert.ok(cr);
      assert.equal(cr.payroll_run_id, 'PR_RUN_SEPT_FROZEN_100');
      assert.equal(cr.file_hash, expectedHash);
      assert.equal(cr.row_count, 2);
      assert.equal(cr.total_wages, 30000);
      assert.equal(cr.total_contributions, 7200); // 3600 * 2
      assert.ok(cr.generation_timestamp);
      assert.equal(cr.status, 'GENERATED');

      // Verify stored in registry
      const stored = getEcrComplianceReturnById(cr.return_id);
      assert.ok(stored);
      assert.equal(stored.file_hash, expectedHash);
    });
  });

  // ==========================================================================
  // 3. IDEMPOTENT SUBMISSION PIPELINE
  // ==========================================================================
  describe('3. Idempotent Submission Pipeline', () => {
    it('3.1 Should track new portal submission in state SUBMITTED', () => {
      const submission = service.submitEcrToPortal({
        payroll_run_id: 'PR_SUBMIT_001',
        file_hash: 'a'.repeat(64),
        file_name: 'EPFO_ECR_DLCPM001_2026_09.txt',
        row_count: 50,
        total_wages: 750000,
        total_contributions: 180000,
      });

      assert.equal(submission.success, true);
      assert.equal(submission.is_idempotent_replay, false);
      assert.equal(submission.tracking_record.status, 'SUBMITTED');
      assert.equal(submission.tracking_record.payroll_run_id, 'PR_SUBMIT_001');
      assert.equal(submission.tracking_record.portal_target, 'EPFO_UNIFIED_PORTAL');
    });

    it('3.2 Should enforce idempotency: return existing tracking record on duplicate retry', () => {
      const fileHash = 'b'.repeat(64);
      const payload = {
        payroll_run_id: 'PR_IDEMPOTENT_TEST',
        file_hash: fileHash,
        file_name: 'EPFO_ECR_DLCPM001_2026_09.txt',
        row_count: 10,
        total_wages: 150000,
        total_contributions: 36000,
      };

      // 1st Attempt: New submission
      const firstRes = service.submitEcrToPortal(payload);
      assert.equal(firstRes.success, true);
      assert.equal(firstRes.is_idempotent_replay, false);
      const originalTrackingId = firstRes.tracking_id;

      // 2nd Attempt: Identical file_hash and run_id
      const secondRes = service.submitEcrToPortal(payload);
      assert.equal(secondRes.success, true);
      assert.equal(secondRes.is_idempotent_replay, true);
      assert.equal(secondRes.tracking_id, originalTrackingId);
      assert.equal(secondRes.tracking_record.tracking_id, originalTrackingId);

      // Verify no duplicate records created in store
      const runs = getSubmissionTrackingByRunId('PR_IDEMPOTENT_TEST');
      assert.equal(runs.length, 1);
    });

    it('3.3 Should allow different payroll_run_id or file_hash as separate submissions', () => {
      const res1 = service.submitEcrToPortal({
        payroll_run_id: 'PR_RUN_A',
        file_hash: 'c'.repeat(64),
      });
      const res2 = service.submitEcrToPortal({
        payroll_run_id: 'PR_RUN_B',
        file_hash: 'c'.repeat(64),
      });

      assert.notEqual(res1.tracking_id, res2.tracking_id);
      assert.equal(res1.is_idempotent_replay, false);
      assert.equal(res2.is_idempotent_replay, false);
    });
  });

  // ==========================================================================
  // 4. TRRN TRACKING & ACKNOWLEDGEMENT INGESTION
  // ==========================================================================
  describe('4. TRRN Tracking & Acknowledgement Ingestion', () => {
    it('4.1 Should ingest 13-digit TRRN, Challan Reference, and calculate 15th statutory due date', () => {
      // 1. Setup submission
      const sub = service.submitEcrToPortal({
        payroll_run_id: 'PR_TRRN_RUN_01',
        file_hash: 'd'.repeat(64),
      });

      // 2. Ingest 13-digit TRRN
      const trrnRes = service.ingestTrrnResponse({
        tracking_id: sub.tracking_id,
        trrn: '1012609012345', // Exactly 13 digits
        challan_reference: 'EPFO_ACK_789456123',
        wage_month: '2026-09',
        challan_generation_date: '2026-09-30',
      });

      assert.equal(trrnRes.success, true);
      assert.equal(trrnRes.trrn_details.trrn, '1012609012345');
      assert.equal(trrnRes.trrn_details.is_strict_13_digit, true);
      assert.equal(trrnRes.trrn_details.challan_reference, 'EPFO_ACK_789456123');
      assert.equal(trrnRes.trrn_details.due_date, '2026-10-15');

      // Verify tracking record updated
      const updatedTracking = getSubmissionTrackingById(sub.tracking_id);
      assert.equal(updatedTracking.status, 'CHALLAN_GENERATED');
      assert.equal(updatedTracking.trrn_details.trrn, '1012609012345');
    });

    it('4.2 Should reject invalid TRRN format', () => {
      assert.throws(
        () => service.ingestTrrnResponse({ trrn: '123' }), // Too short
        /Invalid TRRN format/
      );
      assert.throws(
        () => service.ingestTrrnResponse({ trrn: 'INVALID!@#$' }), // Symbols
        /Invalid TRRN format/
      );
    });

    it('4.3 Should advance ComplianceReturn status to CHALLAN_GENERATED and update challan_details', () => {
      // Generate return
      const gen = service.generateDeterministicEcrReturn({
        payroll_run_id: 'PR_TRRN_CR_TEST',
        period: '2026-09',
        records: [
          {
            employee: { uan: '100777777777', pf_member_id: 'DL/CPM/001', name: 'Sunil Mittal' },
            payroll: { gross_wages: 25000, epf_wages: 15000, employee_pf: 1800, eps: 1250, employer_pf: 550 },
          },
        ],
      });

      // Submit
      const sub = service.submitEcrToPortal({
        payroll_run_id: 'PR_TRRN_CR_TEST',
        return_id: gen.return_id,
        file_hash: gen.file_hash,
      });

      // Ingest TRRN
      const trrn = service.ingestTrrnResponse({
        tracking_id: sub.tracking_id,
        trrn: '1012609099999',
        wage_month: '2026-09',
      });

      const updatedCr = getEcrComplianceReturnById(gen.return_id);
      assert.ok(updatedCr);
      assert.equal(updatedCr.status, 'CHALLAN_GENERATED');
      assert.equal(updatedCr.challan_details.trrn_or_challan_no, '1012609099999');
      assert.equal(updatedCr.challan_details.due_date, '2026-10-15');
    });
  });

  // ==========================================================================
  // 5. REST API ENDPOINTS INTEGRATION
  // ==========================================================================
  describe('5. REST API Endpoints Integration', () => {
    it('5.1 POST /api/v1/pf/generate-ecr-lifecycle should generate deterministic ECR and ComplianceReturn', async () => {
      const payload = {
        payroll_run_id: 'PR_API_LIFECYCLE_RUN',
        period: '2026-09',
        records: [
          {
            employee: { uan: '100888888888', pf_member_id: 'KN/BLR/0099', name: 'Vidya Balan' },
            payroll: { gross_wages: 30000, epf_wages: 15000, employee_pf: 1800, eps: 1250, employer_pf: 550 },
          },
        ],
      };

      const res = await fetch(`${baseUrl}/generate-ecr-lifecycle`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      assert.equal(res.status, 200);
      const json = await res.json();
      assert.equal(json.success, true);
      assert.ok(json.data.file_hash);
      assert.equal(json.data.compliance_return.total_wages, 15000);
      assert.equal(json.data.compliance_return.total_contributions, 3600);
    });

    it('5.2 POST /api/v1/pf/submit-ecr should support idempotent upload retries', async () => {
      const fileHash = 'e'.repeat(64);
      const payload = {
        payroll_run_id: 'PR_API_SUBMIT_RUN',
        file_hash: fileHash,
        file_name: 'EPFO_ECR_API_TEST.txt',
        total_wages: 15000,
        total_contributions: 3600,
      };

      // 1. Initial submission
      const res1 = await fetch(`${baseUrl}/submit-ecr`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      assert.equal(res1.status, 200);
      const json1 = await res1.json();
      assert.equal(json1.success, true);
      assert.equal(json1.is_idempotent_replay, false);

      // 2. Duplicate retry
      const res2 = await fetch(`${baseUrl}/submit-ecr`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      assert.equal(res2.status, 200);
      const json2 = await res2.json();
      assert.equal(json2.success, true);
      assert.equal(json2.is_idempotent_replay, true);
      assert.equal(json2.tracking_id, json1.tracking_id);
    });

    it('5.3 POST /api/v1/pf/trrn-response should ingest TRRN and GET /submission/:id should return details', async () => {
      // First submit
      const subRes = await fetch(`${baseUrl}/submit-ecr`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          payroll_run_id: 'PR_API_TRRN_RUN',
          file_hash: 'f'.repeat(64),
        }),
      });
      const subJson = await subRes.json();
      const trackingId = subJson.tracking_id;

      // Ingest TRRN
      const trrnRes = await fetch(`${baseUrl}/trrn-response`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tracking_id: trackingId,
          trrn: '1012609077777', // 13-digit
          challan_reference: 'ACK_CHALLAN_999',
          wage_month: '2026-09',
        }),
      });
      assert.equal(trrnRes.status, 200);
      const trrnJson = await trrnRes.json();
      assert.equal(trrnJson.success, true);
      assert.equal(trrnJson.data.trrn, '1012609077777');
      assert.equal(trrnJson.data.due_date, '2026-10-15');

      // GET /submission/:tracking_id
      const getRes = await fetch(`${baseUrl}/submission/${trackingId}`);
      assert.equal(getRes.status, 200);
      const getJson = await getRes.json();
      assert.equal(getJson.success, true);
      assert.equal(getJson.data.status, 'CHALLAN_GENERATED');
      assert.equal(getJson.data.trrn_details.trrn, '1012609077777');
    });
  });
});
