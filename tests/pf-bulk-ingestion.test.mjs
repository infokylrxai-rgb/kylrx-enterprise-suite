/**
 * ============================================================================
 * KYLRX AI ENTERPRISE HRMS - EMPLOYEE PF BULK INGESTION TEST SUITE
 * ============================================================================
 * Validates:
 * 1. Domain Entity & Constraints (EmployeePFProfile)
 * 2. Mandatory UAN (12 numeric digits) & Regional Member ID format
 * 3. Date Sequence Integrity (pf_exit_date >= pf_join_date)
 * 4. Contribution Types (STANDARD | RESTRICTED_15K | ACTUAL_WAGE)
 * 5. Duplicate Active UAN & Member ID Detection (Batch & Database level)
 * 6. Staging Rejections with Exact Line and Column Coordinates
 * 7. Transactional Batch Commit of Valid Rows
 * 8. REST API Endpoints Integration
 *
 * @version 6.1.0
 * @author Kylrx AI Principal Backend Architect
 */

import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';

import {
  PfBulkIngestionService,
  globalPfBulkIngestionService,
  clearPfProfileStores,
  parseExcelOrCsvInput,
} from '../services/pf-bulk-ingestion-service.mjs';

import pfComplianceRouter from '../routes/pf-compliance.mjs';

describe('🏛️ Employee PF Profile Subsystem: Domain Schema & Bulk Ingestion Tests', () => {
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
    clearPfProfileStores();
    service = new PfBulkIngestionService();
  });

  // ==========================================================================
  // 1. DOMAIN VALIDATION & STRUCTURAL CHECKS
  // ==========================================================================
  describe('1. Domain Entity & Structural Validations', () => {
    it('1.1 Should commit valid rows with standard fields and ISO dates', () => {
      const rows = [
        {
          employee_id: 'EMP001',
          employee_name: 'Rajesh Kumar',
          uan: '100123456789',
          pf_member_id: 'KN/12345/1234567',
          pf_applicable: true,
          pf_join_date: '2021-04-01',
          pf_exit_date: null,
          eps_applicable: true,
          contribution_type: 'STANDARD',
          voluntary_pf_percent: 5,
        },
        {
          employee_id: 'EMP002',
          employee_name: 'Priya Sharma',
          uan: '100123456790',
          pf_member_id: 'MH/BAN/0012345/000/0000102',
          pf_applicable: true,
          pf_join_date: '2022-06-15',
          pf_exit_date: '2026-08-31',
          eps_applicable: true,
          contribution_type: 'RESTRICTED_15K',
          voluntary_pf_percent: 0,
        },
      ];

      const result = service.ingestMasterFile(rows, { file_name: 'Employee_PF_Master.xlsx' });
      assert.equal(result.total_rows, 2);
      assert.equal(result.committed_rows_count, 2);
      assert.equal(result.rejected_rows_count, 0);

      const p1 = service.getProfileById('EMP001');
      assert.ok(p1);
      assert.equal(p1.uan, '100123456789');
      assert.equal(p1.contribution_type, 'STANDARD');
      assert.equal(p1.is_active, true);

      const p2 = service.getProfileById('EMP002');
      assert.ok(p2);
      assert.equal(p2.is_active, false); // Exited
    });

    it('1.2 Should reject row with missing employee_id and flag exact line/column', () => {
      const rows = [
        {
          employee_id: '',
          uan: '100123456789',
          pf_member_id: 'KN/12345/1234567',
          pf_applicable: true,
          pf_join_date: '2024-01-01',
        },
      ];

      const result = service.ingestMasterFile(rows);
      assert.equal(result.committed_rows_count, 0);
      assert.equal(result.rejected_rows_count, 1);

      const rej = result.rejection_logs[0];
      assert.equal(rej.line_number, 2);
      assert.equal(rej.column_name, 'employee_id');
      assert.equal(rej.error_code, 'ERR_MISSING_EMPLOYEE_ID');
    });
  });

  // ==========================================================================
  // 2. MANDATORY IDENTIFIERS & SYNTAX RULES
  // ==========================================================================
  describe('2. Mandatory Identifiers & Syntax Constraints', () => {
    it('2.1 Should enforce mandatory UAN strictly when pf_applicable === true', () => {
      const rows = [
        {
          employee_id: 'EMP_NO_UAN',
          uan: '',
          pf_member_id: 'KN/12345/1234567',
          pf_applicable: true,
          pf_join_date: '2024-01-01',
        },
      ];

      const result = service.ingestMasterFile(rows);
      assert.equal(result.committed_rows_count, 0);
      assert.equal(result.rejected_rows_count, 1);

      const rej = result.rejection_logs[0];
      assert.equal(rej.column_name, 'uan');
      assert.equal(rej.error_code, 'ERR_MANDATORY_UAN_MISSING');
    });

    it('2.2 Should validate strictly 12 numeric digits for UAN', () => {
      const rows = [
        {
          employee_id: 'EMP_BAD_UAN_1',
          uan: '12345', // Too short
          pf_member_id: 'KN/12345/1234567',
          pf_applicable: true,
          pf_join_date: '2024-01-01',
        },
        {
          employee_id: 'EMP_BAD_UAN_2',
          uan: '10012345678A', // Contains alpha character
          pf_member_id: 'KN/12345/1234568',
          pf_applicable: true,
          pf_join_date: '2024-01-01',
        },
      ];

      const result = service.ingestMasterFile(rows);
      assert.equal(result.committed_rows_count, 0);
      assert.equal(result.rejected_rows_count, 2);

      assert.equal(result.rejection_logs[0].error_code, 'ERR_INVALID_UAN_FORMAT');
      assert.equal(result.rejection_logs[1].error_code, 'ERR_INVALID_UAN_FORMAT');
    });

    it('2.3 Should enforce mandatory Member ID and regional format', () => {
      const rows = [
        {
          employee_id: 'EMP_NO_MID',
          uan: '100123456789',
          pf_member_id: '',
          pf_applicable: true,
          pf_join_date: '2024-01-01',
        },
        {
          employee_id: 'EMP_BAD_MID',
          uan: '100123456790',
          pf_member_id: 'INVALID_MEMBER_FORMAT', // Missing state slash
          pf_applicable: true,
          pf_join_date: '2024-01-01',
        },
      ];

      const result = service.ingestMasterFile(rows);
      assert.equal(result.committed_rows_count, 0);
      assert.equal(result.rejected_rows_count, 2);

      assert.equal(result.rejection_logs[0].error_code, 'ERR_MANDATORY_MEMBER_ID_MISSING');
      assert.equal(result.rejection_logs[1].error_code, 'ERR_INVALID_MEMBER_ID_FORMAT');
    });

    it('2.4 Should allow empty UAN/Member ID when pf_applicable === false (Exempt Employee)', () => {
      const rows = [
        {
          employee_id: 'EMP_EXEMPT',
          uan: '',
          pf_member_id: '',
          pf_applicable: false,
          pf_join_date: '2024-01-01',
        },
      ];

      const result = service.ingestMasterFile(rows);
      assert.equal(result.committed_rows_count, 1);
      assert.equal(result.rejected_rows_count, 0);
    });
  });

  // ==========================================================================
  // 3. DATE SEQUENCE INTEGRITY
  // ==========================================================================
  describe('3. Date Sequence Integrity & Contribution Types', () => {
    it('3.1 Should reject date sequence violation: pf_exit_date < pf_join_date', () => {
      const rows = [
        {
          employee_id: 'EMP_DATE_ERR',
          uan: '100123456789',
          pf_member_id: 'KN/12345/1234567',
          pf_applicable: true,
          pf_join_date: '2024-06-01',
          pf_exit_date: '2024-01-01', // Precedes join date!
        },
      ];

      const result = service.ingestMasterFile(rows);
      assert.equal(result.committed_rows_count, 0);
      assert.equal(result.rejected_rows_count, 1);

      const rej = result.rejection_logs[0];
      assert.equal(rej.column_name, 'pf_exit_date');
      assert.equal(rej.error_code, 'ERR_DATE_SEQUENCE_VIOLATION');
      assert.match(rej.error_message, /Date sequence violation/);
    });

    it('3.2 Should validate contribution_type against enum: STANDARD | RESTRICTED_15K | ACTUAL_WAGE', () => {
      const rows = [
        {
          employee_id: 'EMP_CT_1',
          uan: '100123456781',
          pf_member_id: 'KN/12345/1234561',
          pf_applicable: true,
          pf_join_date: '2024-01-01',
          contribution_type: 'ACTUAL_WAGE',
        },
        {
          employee_id: 'EMP_CT_2',
          uan: '100123456782',
          pf_member_id: 'KN/12345/1234562',
          pf_applicable: true,
          pf_join_date: '2024-01-01',
          contribution_type: 'INVALID_POLICY_TYPE',
        },
      ];

      const result = service.ingestMasterFile(rows);
      assert.equal(result.committed_rows_count, 1); // EMP_CT_1 committed
      assert.equal(result.rejected_rows_count, 1); // EMP_CT_2 rejected

      const rej = result.rejection_logs[0];
      assert.equal(rej.column_name, 'contribution_type');
      assert.equal(rej.error_code, 'ERR_INVALID_CONTRIBUTION_TYPE');
    });
  });

  // ==========================================================================
  // 4. DUPLICATE ACTIVE UAN & MEMBER ID PREVENTION
  // ==========================================================================
  describe('4. Duplicate Active UAN & Member ID Prevention', () => {
    it('4.1 Should reject intra-batch duplicate UAN for active profiles', () => {
      const rows = [
        {
          employee_id: 'EMP_DUP_1',
          uan: '100123456789',
          pf_member_id: 'KN/12345/0000001',
          pf_applicable: true,
          pf_join_date: '2024-01-01',
        },
        {
          employee_id: 'EMP_DUP_2',
          uan: '100123456789', // Duplicate in same batch!
          pf_member_id: 'KN/12345/0000002',
          pf_applicable: true,
          pf_join_date: '2024-01-01',
        },
      ];

      const result = service.ingestMasterFile(rows);
      assert.equal(result.committed_rows_count, 1);
      assert.equal(result.rejected_rows_count, 1);

      const rej = result.rejection_logs[0];
      assert.equal(rej.column_name, 'uan');
      assert.equal(rej.error_code, 'ERR_DUPLICATE_UAN');
      assert.match(rej.error_message, /conflicts with EMP_DUP_1/);
    });

    it('4.2 Should reject duplicate UAN matching an existing active database profile', () => {
      // Seed an active profile in database
      service.ingestMasterFile([
        {
          employee_id: 'EMP_EXISTING',
          uan: '100123456789',
          pf_member_id: 'KN/12345/0000001',
          pf_applicable: true,
          pf_join_date: '2023-01-01',
        },
      ]);

      // Attempt to ingest a new employee with identical active UAN
      const result = service.ingestMasterFile([
        {
          employee_id: 'EMP_NEW',
          uan: '100123456789',
          pf_member_id: 'KN/12345/0000002',
          pf_applicable: true,
          pf_join_date: '2024-01-01',
        },
      ]);

      assert.equal(result.committed_rows_count, 0);
      assert.equal(result.rejected_rows_count, 1);
      assert.equal(result.rejection_logs[0].error_code, 'ERR_DUPLICATE_UAN');
      assert.match(result.rejection_logs[0].error_message, /already active on existing employee 'EMP_EXISTING'/);
    });
  });

  // ==========================================================================
  // 5. CSV / EXCEL PARSER & ATOMIC STAGING
  // ==========================================================================
  describe('5. Universal Ingestion & Atomic Batch Commits', () => {
    it('5.1 Should parse raw CSV text input with row-level validation', () => {
      const csvData = [
        'employee_id,employee_name,uan,pf_member_id,pf_applicable,pf_join_date,contribution_type',
        'EMP101,Aakash Roy,100123456789,KN/12345/0000101,true,2024-01-01,STANDARD',
        'EMP102,Meera Sen,INVALID_UAN,KN/12345/0000102,true,2024-01-01,STANDARD',
        'EMP103,Sunil Nair,100123456799,KN/12345/0000103,true,2024-02-01,ACTUAL_WAGE',
      ].join('\r\n');

      const result = service.ingestMasterFile(csvData, { file_name: 'Employee_PF_Master.csv' });
      assert.equal(result.total_rows, 3);
      assert.equal(result.committed_rows_count, 2); // EMP101 and EMP103
      assert.equal(result.rejected_rows_count, 1);  // EMP102 rejected

      assert.equal(result.rejection_logs[0].line_number, 3);
      assert.equal(result.rejection_logs[0].column_name, 'uan');
      assert.equal(result.rejection_logs[0].rejected_value, 'INVALID_UAN');

      // Database should contain only valid rows
      assert.ok(service.getProfileById('EMP101'));
      assert.ok(service.getProfileById('EMP103'));
      assert.equal(service.getProfileById('EMP102'), null);
    });
  });

  // ==========================================================================
  // 6. REST API INTEGRATION
  // ==========================================================================
  describe('6. REST API Endpoints Integration', () => {
    beforeEach(() => {
      globalPfBulkIngestionService.ingestMasterFile([
        {
          employee_id: 'API_EMP_1',
          employee_name: 'Tarun Bose',
          uan: '100123456789',
          pf_member_id: 'DL/CPM/0001234/000/0000101',
          pf_applicable: true,
          pf_join_date: '2024-03-01',
          contribution_type: 'STANDARD',
        },
      ], { file_name: 'Seed.xlsx', batch_id: 'SEED_BATCH_001' });
    });

    it('6.1 POST /api/v1/pf/upload-master should ingest rows and return staging summary', async () => {
      const payload = {
        file_name: 'Employee_PF_Master.xlsx',
        records: [
          {
            employee_id: 'API_EMP_UPLOAD_1',
            employee_name: 'Anita Desai',
            uan: '100987654321',
            pf_member_id: 'DL/CPM/0001234/000/0000102',
            pf_applicable: true,
            pf_join_date: '2024-03-01',
            contribution_type: 'STANDARD',
          },
          {
            employee_id: 'API_EMP_UPLOAD_2',
            employee_name: 'Karan Shah',
            uan: '123', // Invalid UAN
            pf_member_id: 'DL/CPM/0001234/000/0000103',
            pf_applicable: true,
            pf_join_date: '2024-03-01',
          },
        ],
      };

      const res = await fetch(`${baseUrl}/upload-master`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      assert.equal(res.status, 200);
      const json = await res.json();
      assert.equal(json.success, true);
      assert.equal(json.count, 1);
      assert.equal(json.data.committed_rows_count, 1);
      assert.equal(json.data.rejected_rows_count, 1);
    });

    it('6.2 GET /api/v1/pf/profiles should return committed profiles', async () => {
      const res = await fetch(`${baseUrl}/profiles`);
      assert.equal(res.status, 200);
      const json = await res.json();
      assert.equal(json.success, true);
      assert.ok(json.data.total_count >= 1);
    });

    it('6.3 GET /api/v1/pf/profiles/:id should return single profile', async () => {
      const res = await fetch(`${baseUrl}/profiles/API_EMP_1`);
      assert.equal(res.status, 200);
      const json = await res.json();
      assert.equal(json.success, true);
      assert.equal(json.data.employee_id, 'API_EMP_1');
      assert.equal(json.data.uan, '100123456789');
    });

    it('6.4 GET /api/v1/pf/rejections/:batch_id should retrieve staging rejections', async () => {
      const uploadRes = await fetch(`${baseUrl}/upload-master`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          batch_id: 'BATCH_REJECT_TEST',
          records: [
            {
              employee_id: 'EMP_BAD_DATE',
              uan: '100111222333',
              pf_member_id: 'MH/12345/0001111',
              pf_applicable: true,
              pf_join_date: '2024-05-01',
              pf_exit_date: '2024-01-01', // date sequence error
            },
          ],
        }),
      });
      assert.equal(uploadRes.status, 200);

      const rejRes = await fetch(`${baseUrl}/rejections/BATCH_REJECT_TEST`);
      assert.equal(rejRes.status, 200);
      const rejJson = await rejRes.json();
      assert.equal(rejJson.success, true);
      assert.equal(rejJson.data.rejection_count, 1);
      assert.equal(rejJson.data.rejections[0].error_code, 'ERR_DATE_SEQUENCE_VIOLATION');
    });
  });
});
