/**
 * ============================================================================
 * KYLRX AI ENTERPRISE HRMS - PF ACCESS CONTROL, DATA MASKING & AUDIT TEST SUITE
 * ============================================================================
 * Validates:
 * 1. UI & Log Masking Serialization Transforms:
 *    - UAN masked to terminal digits (e.g., ••••••••5678)
 *    - PF Member ID masked to establishment codes (e.g., KN/12345/•••••••)
 *    - Deep sanitization for application log drains
 * 2. Role-Based Access Control (RBAC):
 *    - Privileged Roles: 'PAYROLL_ADMIN', 'COMPLIANCE_OFFICER' (case/space-insensitive)
 *    - Strict enforcement: unmasked views and raw export downloads blocked with 403
 * 3. Unified Audit Logger & Distributed Tracing:
 *    - Append-only recording of MASTER_DATA_MODIFICATION (old vs new), overrides, files, TRRN
 *    - Distributed correlation_id end-to-end lifecycle tracing
 * 4. REST API Endpoint Integration:
 *    - GET /profiles & GET /profiles/:id masked for non-privileged, unmasked for privileged
 *    - GET /export/:batch_id returns 403 for unauthorized callers, 200 for privileged
 *    - POST /audit/record & GET /audit/trace/:correlation_id lifecycle verification
 *
 * @version 6.4.0
 * @author Kylrx AI Lead Security & Compliance Architect
 */

import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';

import {
  PfSecurityAuditService,
  globalPfSecurityAuditService,
  PrivilegedComplianceAccessError,
  PRIVILEGED_COMPLIANCE_ROLES,
  AUDIT_ACTION_TYPES,
} from '../services/pf-security-audit-service.mjs';

import {
  globalComplianceAuditStream,
} from '../services/compliance-audit-logger.mjs';

import {
  globalPfBulkIngestionService,
  clearPfProfileStores,
} from '../services/pf-bulk-ingestion-service.mjs';

import {
  globalPfEcrAutomationEngine,
} from '../services/pf-ecr-automation-engine.mjs';

import pfComplianceRouter from '../routes/pf-compliance.mjs';

describe('🛡️ PF Compliance Access Control, Data Masking & Unified Audit Suite', () => {
  let app;
  let server;
  let baseUrl;

  before(async () => {
    app = express();
    app.use(express.json());
    app.use('/api/v1/compliance/pf', pfComplianceRouter);

    await new Promise((resolve) => {
      server = app.listen(0, () => {
        const port = server.address().port;
        baseUrl = `http://127.0.0.1:${port}/api/v1/compliance/pf`;
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
    globalComplianceAuditStream.clear();
  });

  // ==========================================================================
  // 1. DATA MASKING TRANSFORMS
  // ==========================================================================
  describe('1️⃣ Data Masking Serialization Transforms', () => {
    it('masks 12-digit UAN preserving strictly terminal 4 digits', () => {
      const masked = PfSecurityAuditService.maskUan('100123455678');
      assert.equal(masked, '••••••••5678');
      assert.equal(masked.length, 12);
      assert.ok(masked.startsWith('••••••••'));
      assert.ok(masked.endsWith('5678'));
    });

    it('handles short or empty UANs gracefully without throwing', () => {
      assert.equal(PfSecurityAuditService.maskUan(''), '');
      assert.equal(PfSecurityAuditService.maskUan(null), '');
      assert.equal(PfSecurityAuditService.maskUan('123'), '123');
      assert.equal(PfSecurityAuditService.maskUan('5678'), '5678');
    });

    it('masks regional PF Member IDs retaining establishment code prefix (KN/12345/•••••••)', () => {
      const regional = PfSecurityAuditService.maskPfMemberId('KN/12345/1234567');
      assert.equal(regional, 'KN/12345/•••••••');
      assert.ok(regional.startsWith('KN/12345/'));
      assert.ok(regional.endsWith('•••••••'));
    });

    it('masks multi-segment establishment Member IDs (MH/BAN/0012345/•••••••)', () => {
      const multi = PfSecurityAuditService.maskPfMemberId('MH/BAN/0012345/000/0000101');
      assert.equal(multi, 'MH/BAN/0012345/000/•••••••');
      assert.ok(multi.startsWith('MH/BAN/0012345/000/'));
    });

    it('masks 2-segment Member IDs correctly', () => {
      const twoSeg = PfSecurityAuditService.maskPfMemberId('ESTB123/9876543');
      assert.equal(twoSeg, 'ESTB123/•••••••');
    });

    it('deeply sanitizes nested objects and structures for log drains', () => {
      const rawLogPayload = {
        employee_id: 'EMP101',
        uan: '100987654321',
        pf_member_id: 'KN/54321/7654321',
        bank_account_number: '987654321012',
        metadata: {
          approver: 'admin@kylrx.ai',
          nested_profile: {
            uan: '100111222333',
            member_id: 'MH/11111/2222222',
          },
        },
      };

      const sanitized = PfSecurityAuditService.sanitizeForLog(rawLogPayload);
      assert.equal(sanitized.uan, '••••••••4321');
      assert.equal(sanitized.pf_member_id, 'KN/54321/•••••••');
      assert.equal(sanitized.bank_account_number, '••••••••1012');
      assert.equal(sanitized.metadata.nested_profile.uan, '••••••••2333');
      assert.equal(sanitized.metadata.nested_profile.member_id, 'MH/11111/•••••••');
    });

    it('sanitizes embedded UANs and Member IDs within raw log message strings', () => {
      const rawMessage = 'Validation failed: UAN 100987654321 and PF ID KN/12345/1234567 mismatch.';
      const sanitized = PfSecurityAuditService.sanitizeForLog(rawMessage);
      assert.ok(!sanitized.includes('100987654321'));
      assert.ok(!sanitized.includes('1234567'));
      assert.ok(sanitized.includes('••••••••4321'));
      assert.ok(sanitized.includes('KN/12345/•••••••'));
    });
  });

  // ==========================================================================
  // 2. ROLE-BASED ACCESS CONTROL (RBAC)
  // ==========================================================================
  describe('2️⃣ Role-Based Access Control (RBAC) & Authorization', () => {
    it('identifies privileged roles with case and whitespace insensitivity', () => {
      assert.equal(PfSecurityAuditService.isPrivilegedRole('Payroll Admin'), true);
      assert.equal(PfSecurityAuditService.isPrivilegedRole('PAYROLL_ADMIN'), true);
      assert.equal(PfSecurityAuditService.isPrivilegedRole('payroll_admin'), true);
      assert.equal(PfSecurityAuditService.isPrivilegedRole('Compliance Officer'), true);
      assert.equal(PfSecurityAuditService.isPrivilegedRole('COMPLIANCE_OFFICER'), true);
      assert.equal(PfSecurityAuditService.isPrivilegedRole('compliance_officer'), true);
    });

    it('rejects unprivileged and null roles', () => {
      assert.equal(PfSecurityAuditService.isPrivilegedRole('EMPLOYEE'), false);
      assert.equal(PfSecurityAuditService.isPrivilegedRole('HR_ANALYST'), false);
      assert.equal(PfSecurityAuditService.isPrivilegedRole('FINANCE_VIEWER'), false);
      assert.equal(PfSecurityAuditService.isPrivilegedRole('AUDITOR'), false);
      assert.equal(PfSecurityAuditService.isPrivilegedRole(null), false);
      assert.equal(PfSecurityAuditService.isPrivilegedRole(undefined), false);
      assert.equal(PfSecurityAuditService.isPrivilegedRole(''), false);
    });

    it('assertPrivilegedAccess throws 403 PrivilegedComplianceAccessError for unprivileged roles', () => {
      assert.throws(
        () => PfSecurityAuditService.assertPrivilegedAccess('EMPLOYEE', 'download raw export'),
        (err) => {
          assert.equal(err.name, 'PrivilegedComplianceAccessError');
          assert.equal(err.statusCode, 403);
          assert.equal(err.code, 'PRIVILEGED_ACCESS_REQUIRED');
          return true;
        }
      );
    });

    it('assertPrivilegedAccess succeeds for privileged roles', () => {
      assert.doesNotThrow(() => {
        PfSecurityAuditService.assertPrivilegedAccess('Payroll Admin', 'access raw data');
      });
      assert.doesNotThrow(() => {
        PfSecurityAuditService.assertPrivilegedAccess('Compliance Officer', 'access raw data');
      });
    });

    it('serializes profile as masked for non-privileged callers and unmasked for privileged callers', () => {
      const sampleProfile = {
        employee_id: 'EMP001',
        employee_name: 'Rajesh Kumar',
        uan: '100123456789',
        pf_member_id: 'KN/12345/1234567',
        pf_applicable: true,
      };

      // Non-privileged view
      const employeeView = PfSecurityAuditService.serializePfProfile(sampleProfile, 'EMPLOYEE');
      assert.equal(employeeView.uan, '••••••••6789');
      assert.equal(employeeView.pf_member_id, 'KN/12345/•••••••');
      assert.equal(employeeView.is_masked, true);

      // Privileged view
      const adminView = PfSecurityAuditService.serializePfProfile(sampleProfile, 'PAYROLL_ADMIN');
      assert.equal(adminView.uan, '100123456789');
      assert.equal(adminView.pf_member_id, 'KN/12345/1234567');
      assert.equal(adminView.is_masked, false);
    });
  });

  // ==========================================================================
  // 3. UNIFIED AUDIT LOGGER & DISTRIBUTED CORRELATION TRACING
  // ==========================================================================
  describe('3️⃣ Unified Audit Logger & Distributed Correlation Tracing', () => {
    it('records immutable audit events with old vs new values for master data modifications', () => {
      const correlationId = `corr_test_${Date.now()}`;
      const record = PfSecurityAuditService.recordAuditEvent({
        action_type: AUDIT_ACTION_TYPES.MASTER_DATA_MODIFICATION,
        entity_type: 'EmployeePFProfile',
        entity_id: 'EMP001',
        actor_id: 'usr_payroll_lead_01',
        actor_role: 'PAYROLL_ADMIN',
        correlation_id: correlationId,
        old_values: {
          uan: '100123456789',
          voluntary_pf_percent: 0,
        },
        new_values: {
          uan: '100123456789',
          voluntary_pf_percent: 5,
        },
        details: {
          reason: 'Employee requested voluntary PF deduction increase to 5%',
        },
      });

      assert.ok(record.event_id.startsWith('evt_'));
      assert.equal(record.correlation_id, correlationId);
      assert.equal(record.action_type, AUDIT_ACTION_TYPES.MASTER_DATA_MODIFICATION);

      // Verify log sanitization within the recorded audit metadata
      assert.equal(record.audit_record.metadata.old_values.uan, '••••••••6789');
      assert.equal(record.audit_record.metadata.new_values.uan, '••••••••6789');
      assert.equal(record.audit_record.metadata.new_values.voluntary_pf_percent, 5);
    });

    it('records audit events for validation failures, overrides, file generation, and TRRN updates', () => {
      const correlationId = `corr_lifecycle_${Date.now()}`;

      // 1. Validation Failure
      const failureEvt = PfSecurityAuditService.recordAuditEvent({
        action_type: AUDIT_ACTION_TYPES.VALIDATION_FAILURE,
        entity_id: 'BATCH_2026_09',
        actor_id: 'pf_validation_engine',
        correlation_id: correlationId,
        details: {
          error_code: 'INVALID_UAN_FORMAT',
          rejected_employee: 'EMP004',
          invalid_uan: '100123',
        },
      });
      assert.ok(failureEvt.event_id);

      // 2. Calculation Override
      const overrideEvt = PfSecurityAuditService.recordAuditEvent({
        action_type: AUDIT_ACTION_TYPES.CALCULATION_OVERRIDE,
        entity_id: 'EMP002',
        actor_id: 'usr_compliance_lead',
        actor_role: 'COMPLIANCE_OFFICER',
        correlation_id: correlationId,
        details: {
          original_pf_wages: 15000,
          overridden_pf_wages: 18000,
          justification: 'Court order statutory adjustment',
        },
      });
      assert.ok(overrideEvt.event_id);

      // 3. File Generated
      const fileEvt = PfSecurityAuditService.recordAuditEvent({
        action_type: AUDIT_ACTION_TYPES.FILE_GENERATED,
        entity_id: 'RET_2026_09_ECR',
        actor_id: 'ecr_generator_service',
        correlation_id: correlationId,
        details: {
          file_name: 'ECR_2026_09.txt',
          sha256_hash: 'a'.repeat(64),
          row_count: 50,
        },
      });
      assert.ok(fileEvt.event_id);

      // 4. TRRN Updated
      const trrnEvt = PfSecurityAuditService.recordAuditEvent({
        action_type: AUDIT_ACTION_TYPES.TRRN_UPDATED,
        entity_id: 'RET_2026_09_ECR',
        actor_id: 'portal_ingestion_worker',
        correlation_id: correlationId,
        details: {
          trrn: '1012309123456',
          challan_ref: 'CHAL-SEP26-001',
          due_date: '2026-10-15',
        },
      });
      assert.ok(trrnEvt.event_id);

      // End-to-end trace by correlationId
      const trace = PfSecurityAuditService.traceAuditTrailByCorrelationId(correlationId);
      assert.equal(trace.length, 4);
      assert.equal(trace[0].metadata.action_type, AUDIT_ACTION_TYPES.VALIDATION_FAILURE);
      assert.equal(trace[1].metadata.action_type, AUDIT_ACTION_TYPES.CALCULATION_OVERRIDE);
      assert.equal(trace[2].metadata.action_type, AUDIT_ACTION_TYPES.FILE_GENERATED);
      assert.equal(trace[3].metadata.action_type, AUDIT_ACTION_TYPES.TRRN_UPDATED);
    });
  });

  // ==========================================================================
  // 4. REST API INTEGRATION & ACCESS CONTROL
  // ==========================================================================
  describe('4️⃣ REST API Endpoints Integration: Masking, Export Guard & Audit', () => {
    beforeEach(() => {
      // Seed two test profiles
      globalPfBulkIngestionService.ingestMasterFile([
        {
          employee_id: 'EMP_SEC_01',
          employee_name: 'Ananya Roy',
          uan: '100123456789',
          pf_member_id: 'KN/12345/1234567',
          pf_applicable: true,
          eps_applicable: true,
          pf_join_date: '2022-01-01',
          contribution_type: 'STANDARD',
        },
        {
          employee_id: 'EMP_SEC_02',
          employee_name: 'Vikram Mehta',
          uan: '100987654321',
          pf_member_id: 'MH/BAN/0012345/000/0000101',
          pf_applicable: true,
          eps_applicable: true,
          pf_join_date: '2023-05-15',
          contribution_type: 'STANDARD',
        },
      ], { batch_id: 'SEED_BATCH_01' });

      // Seed an export file
      globalPfEcrAutomationEngine.exportFiles.set('BATCH_SEC_EXP_01', {
        txt: '100123456789#~#Ananya Roy#~#15000#~#1800\r\n',
        manifest: {
          file_name: 'ECR_TEST_SEC.txt',
          checksum_sha256: 'abc123hash',
        },
      });
    });

    it('GET /profiles returns masked UAN and Member ID for unprivileged users', async () => {
      const res = await fetch(`${baseUrl}/profiles`, {
        headers: { 'x-user-role': 'EMPLOYEE' },
      });
      assert.equal(res.status, 200);
      const body = await res.json();
      assert.equal(body.success, true);
      assert.equal(body.data.is_masked, true);
      assert.equal(body.data.profiles.length, 2);

      const p1 = body.data.profiles.find((p) => p.employee_id === 'EMP_SEC_01');
      assert.equal(p1.uan, '••••••••6789');
      assert.equal(p1.pf_member_id, 'KN/12345/•••••••');
      assert.equal(p1.is_masked, true);
    });

    it('GET /profiles returns raw unmasked identifiers for privileged Compliance Officer', async () => {
      const res = await fetch(`${baseUrl}/profiles`, {
        headers: { 'x-user-role': 'Compliance Officer' },
      });
      assert.equal(res.status, 200);
      const body = await res.json();
      assert.equal(body.success, true);
      assert.equal(body.data.is_masked, false);

      const p1 = body.data.profiles.find((p) => p.employee_id === 'EMP_SEC_01');
      assert.equal(p1.uan, '100123456789');
      assert.equal(p1.pf_member_id, 'KN/12345/1234567');
      assert.equal(p1.is_masked, false);
    });

    it('GET /profiles/:id returns masked view for unprivileged user and unmasked for Payroll Admin', async () => {
      // Non-privileged
      const resUnpriv = await fetch(`${baseUrl}/profiles/EMP_SEC_02`, {
        headers: { 'x-user-role': 'AUDITOR' },
      });
      assert.equal(resUnpriv.status, 200);
      const bodyUnpriv = await resUnpriv.json();
      assert.equal(bodyUnpriv.data.uan, '••••••••4321');
      assert.equal(bodyUnpriv.data.pf_member_id, 'MH/BAN/0012345/000/•••••••');
      assert.equal(bodyUnpriv.data.is_masked, true);

      // Privileged
      const resPriv = await fetch(`${baseUrl}/profiles/EMP_SEC_02`, {
        headers: { 'x-user-role': 'PAYROLL_ADMIN' },
      });
      assert.equal(resPriv.status, 200);
      const bodyPriv = await resPriv.json();
      assert.equal(bodyPriv.data.uan, '100987654321');
      assert.equal(bodyPriv.data.pf_member_id, 'MH/BAN/0012345/000/0000101');
      assert.equal(bodyPriv.data.is_masked, false);
    });

    it('GET /export/:batch_id rejects unprivileged callers with 403 Forbidden', async () => {
      const res = await fetch(`${baseUrl}/export/BATCH_SEC_EXP_01`, {
        headers: { 'x-user-role': 'EMPLOYEE' },
      });
      assert.equal(res.status, 403);
      const body = await res.json();
      assert.equal(body.success, false);
      assert.equal(body.error.code, 'PRIVILEGED_ACCESS_REQUIRED');
      assert.ok(body.error.message.includes('unauthorized'));
    });

    it('GET /export/:batch_id permits download for privileged roles (Payroll Admin)', async () => {
      const res = await fetch(`${baseUrl}/export/BATCH_SEC_EXP_01`, {
        headers: { 'x-user-role': 'Payroll Admin' },
      });
      assert.equal(res.status, 200);
      const text = await res.text();
      assert.ok(text.includes('100123456789#~#Ananya Roy'));
    });

    it('POST /audit/record and GET /audit/trace/:correlation_id enables end-to-end lifecycle querying', async () => {
      const correlationId = `corr_api_lifecycle_${Date.now()}`;

      // Record an audit log via API
      const recordRes = await fetch(`${baseUrl}/audit/record`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-user-role': 'COMPLIANCE_OFFICER',
          'x-user-id': 'usr_comp_99',
        },
        body: JSON.stringify({
          action_type: AUDIT_ACTION_TYPES.TRRN_UPDATED,
          entity_id: 'RET_SEP26_01',
          correlation_id: correlationId,
          details: {
            trrn: '9998887776665',
            status: 'CHALLAN_ACKNOWLEDGED',
          },
        }),
      });

      assert.equal(recordRes.status, 200);
      const recordData = await recordRes.json();
      assert.equal(recordData.success, true);
      assert.equal(recordData.data.correlation_id, correlationId);

      // Trace via API
      const traceRes = await fetch(`${baseUrl}/audit/trace/${correlationId}`);
      assert.equal(traceRes.status, 200);
      const traceData = await traceRes.json();
      assert.equal(traceData.success, true);
      assert.equal(traceData.data.correlation_id, correlationId);
      assert.equal(traceData.data.event_count, 1);
      assert.equal(traceData.data.events[0].entity_id, 'RET_SEP26_01');
    });
  });
});
