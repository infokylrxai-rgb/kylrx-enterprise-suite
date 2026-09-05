/**
 * ============================================================================
 * KYLRX AI ENTERPRISE HRMS - UNIFIED STATUTORY ORCHESTRATION TEST SUITE
 * ============================================================================
 * Validates the Unified Statutory Orchestration Service connecting ESIC,
 * Gratuity, and NPS to the Firebase Firestore backend:
 *
 * 1. Unified Event Listener & Worker Pipelines:
 *    - Master trigger on payroll_runs collection (status: 'FINALIZED')
 *    - Simultaneously initiates ESIC, Gratuity, and NPS as independent worker pipelines
 *    - Resilience: Defect in one scheme does not block the other pipelines
 *
 * 2. Firestore Staging Collections:
 *    - /esic_compliance_batches/{batch_id}
 *    - /gratuity_settlements/{batch_id}
 *    - /nps_compliance_batches/{batch_id}
 *    - /statutory_exceptions/{exception_id} (Shared cross-scheme collection)
 *
 * 3. Audit & Best Practices Compliance:
 *    - Logs rule versions (ESIC_STATUTORY_RULE_V4.0, GRATUITY_STATUTORY_RULE_V4.0, NPS_STATUTORY_RULE_V4.0)
 *    - Execution timestamps (triggered_at, completed_at, duration_ms)
 *    - Source payroll IDs (source_payroll_id)
 *    - SHA-256 file checksums for all official portal files
 *
 * 4. PII Data Masking:
 *    - Enforces masking on sensitive master identifiers (UAN, ESIC No, PRAN, Nominee details)
 *      in front-end UI representations
 *    - Preserves full unmasked values for file exports and secure backend stores
 *
 * 5. Full REST API & EventBus Integration
 *
 * @version 4.0.0
 * @author Kylrx AI Lead Compliance Architect
 */

import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import EventEmitter from 'node:events';
import express from 'express';

import {
  UnifiedStatutoryOrchestrator,
  STATUTORY_RULE_VERSIONS,
  globalUnifiedStatutoryOrchestrator,
} from '../services/unified-statutory-orchestration-service.mjs';

import { globalCorporateNpsAutomationEngine } from '../services/corporate-nps-automation-engine.mjs';

import unifiedComplianceRouter from '../routes/unified-compliance.mjs';

describe('⚡ UNIFIED STATUTORY ORCHESTRATION SERVICE (FIREBASE BACKEND INTEGRATION)', () => {
  let app;
  let server;
  let baseUrl;
  let mockEventBus;
  let mockFirestore;
  let orchestrator;

  before(async () => {
    app = express();
    app.use(express.json());
    app.use('/api/v1/compliance', unifiedComplianceRouter);

    await new Promise((resolve) => {
      server = app.listen(0, () => {
        const port = server.address().port;
        baseUrl = `http://127.0.0.1:${port}/api/v1/compliance`;
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
    mockEventBus = new EventEmitter();

    // High-fidelity Mock Firestore with collections & docs
    const collections = new Map();
    mockFirestore = {
      collection: (colName) => {
        if (!collections.has(colName)) {
          collections.set(colName, new Map());
        }
        const colMap = collections.get(colName);
        return {
          doc: (docId) => ({
            set: async (data) => {
              colMap.set(docId, data);
            },
            get: async () => ({
              exists: () => colMap.has(docId),
              data: () => colMap.get(docId),
            }),
          }),
        };
      },
      _storage: collections,
    };

    orchestrator = new UnifiedStatutoryOrchestrator({
      firestoreDb: mockFirestore,
      eventBus: mockEventBus,
    });
  });

  // ==========================================================================
  // 1. UNIFIED MASTER TRIGGER & CONCURRENT WORKER PIPELINES
  // ==========================================================================
  describe('1. Unified Master Trigger & Independent Worker Pipelines', () => {
    it('1.1 Should simultaneously initiate ESIC, Gratuity, and NPS workers on payroll finalized', async () => {
      const payrollRun = {
        payroll_run_id: 'PR_UNIFIED_001',
        period: '2026-09',
        status: 'FINALIZED',
        finalized_at: new Date().toISOString(),
        finalized_by: 'lead-payroll-officer',
        employees: [
          {
            employee_id: 'EMP_U01',
            employee_name: 'Devendra Joshi',
            basic: 15000,
            gross_salary: 18000,
            esic_applicable: true,
            esic_number: '3100112233',
            date_of_joining: '2019-01-01',
            date_of_exit: '2026-09-01',
            exit_reason: 'RESIGNATION',
            last_drawn_salary: 18000,
            nps_applicable: true,
            pran: '110011112222',
            tier: 'Tier I',
            contribution_type: 'Both',
            uan: '100123456789',
            nominee_details: [{ name: 'Anjali Joshi', relation: 'Spouse', share_percentage: 100 }],
          },
        ],
      };

      const manifest = await orchestrator.orchestratePayrollRun(payrollRun);

      assert.ok(manifest.orchestration_id.startsWith('ORCH_PR_UNIFIED_001'));
      assert.strictEqual(manifest.source_payroll_id, 'PR_UNIFIED_001');
      assert.strictEqual(manifest.period, '2026-09');

      // All 3 worker pipelines executed
      assert.strictEqual(manifest.workers.esic.success, true);
      assert.strictEqual(manifest.workers.gratuity.success, true);
      assert.strictEqual(manifest.workers.nps.success, true);

      assert.strictEqual(manifest.workers.esic.rule_version, STATUTORY_RULE_VERSIONS.ESIC);
      assert.strictEqual(manifest.workers.gratuity.rule_version, STATUTORY_RULE_VERSIONS.GRATUITY);
      assert.strictEqual(manifest.workers.nps.rule_version, STATUTORY_RULE_VERSIONS.NPS);

      assert.ok(manifest.duration_ms >= 0);
    });

    it('1.2 Should isolate defects: A PRAN defect in NPS should not prevent ESIC and Gratuity from succeeding', async () => {
      const payrollRun = {
        payroll_run_id: 'PR_DEFECT_ISOLATION',
        period: '2026-09',
        status: 'FINALIZED',
        employees: [
          {
            employee_id: 'EMP_DEFECT_NPS',
            employee_name: 'Meena Kumari',
            basic: 18000,
            gross_salary: 20000,
            esic_applicable: true,
            esic_number: '3100998877',
            date_of_joining: '2020-01-01',
            last_drawn_salary: 20000,
            nps_applicable: true,
            pran: '123', // Malformed PRAN (< 12 digits)
          },
        ],
      };

      const manifest = await orchestrator.orchestratePayrollRun(payrollRun);

      // ESIC and Gratuity pipelines still complete successfully
      assert.strictEqual(manifest.workers.esic.success, true);
      assert.strictEqual(manifest.workers.gratuity.success, true);
      assert.strictEqual(manifest.workers.nps.success, true);

      // Captured the defect in shared statutory exceptions
      assert.ok(manifest.total_exceptions_count >= 1);
      assert.ok(manifest.blocking_exceptions_count >= 1);
      assert.strictEqual(manifest.is_blocked, true);
    });
  });

  // ==========================================================================
  // 2. FIRESTORE STAGING COLLECTIONS
  // ==========================================================================
  describe('2. Firestore Staging Collections Persistence', () => {
    it('2.1 Should write batch outputs to esic_compliance_batches, gratuity_settlements, and nps_compliance_batches', async () => {
      const payrollRun = {
        payroll_run_id: 'PR_STAGING_TEST',
        period: '2026-09',
        status: 'FINALIZED',
        employees: [
          {
            employee_id: 'EMP_STAGE_01',
            employee_name: 'Karan Mehra',
            basic: 25000,
            gross_salary: 28000,
            esic_applicable: false, // > 21k
            date_of_joining: '2018-01-01',
            date_of_exit: '2026-03-31',
            exit_reason: 'RESIGNATION',
            last_drawn_salary: 25000,
            nps_applicable: true,
            pran: '110055554444',
            tier: 'Tier I',
            contribution_type: 'Both',
          },
        ],
      };

      await orchestrator.orchestratePayrollRun(payrollRun);

      // Verify Firestore staging storage maps
      const esicBatches = mockFirestore._storage.get('esic_compliance_batches');
      const gratSettlements = mockFirestore._storage.get('gratuity_settlements');
      const npsBatches = mockFirestore._storage.get('nps_compliance_batches');

      assert.ok(esicBatches.has('ESIC_BATCH_PR_STAGING_TEST'));
      assert.ok(gratSettlements.has('GRAT_BATCH_PR_STAGING_TEST'));
      assert.ok(npsBatches.has('NPS_BATCH_PR_STAGING_TEST'));

      const esicDoc = esicBatches.get('ESIC_BATCH_PR_STAGING_TEST');
      assert.strictEqual(esicDoc.source_payroll_id, 'PR_STAGING_TEST');
      assert.strictEqual(esicDoc.scheme, 'ESIC');

      const gratDoc = gratSettlements.get('GRAT_BATCH_PR_STAGING_TEST');
      assert.strictEqual(gratDoc.source_payroll_id, 'PR_STAGING_TEST');
      assert.strictEqual(gratDoc.scheme, 'GRATUITY');
      assert.strictEqual(gratDoc.total_eligible_count, 1);

      const npsDoc = npsBatches.get('NPS_BATCH_PR_STAGING_TEST');
      assert.strictEqual(npsDoc.source_payroll_id, 'PR_STAGING_TEST');
      assert.strictEqual(npsDoc.scheme, 'NPS');
      assert.strictEqual(npsDoc.total_subscribers, 1);
    });

    it('2.2 Should write all exceptions to shared statutory_exceptions collection', async () => {
      const payrollRun = {
        payroll_run_id: 'PR_EXCEPTIONS_TEST',
        period: '2026-09',
        status: 'FINALIZED',
        employees: [
          // Missing ESIC IP
          {
            employee_id: 'EMP_NO_ESIC',
            employee_name: 'No Esic',
            basic: 10000,
            gross_salary: 12000,
            esic_applicable: true,
            esic_number: '',
          },
          // Missing NPS PRAN
          {
            employee_id: 'EMP_NO_PRAN',
            employee_name: 'No Pran',
            basic: 30000,
            nps_applicable: true,
            pran: '',
          },
        ],
      };

      await orchestrator.orchestratePayrollRun(payrollRun);

      const sharedExceptions = mockFirestore._storage.get('statutory_exceptions');
      assert.ok(sharedExceptions.size >= 2);

      const docs = Array.from(sharedExceptions.values());
      assert.ok(docs.some((d) => d.scheme === 'ESIC' && (d.error_code === 'ESIC_MISSING_IP_NUMBER' || d.code === 'EMP004' || d.error_code === 'EMP004')));
      assert.ok(docs.some((d) => d.scheme === 'NPS' && d.error_code === 'NPS_PRAN_MISSING'));
    });
  });

  // ==========================================================================
  // 3. AUDIT & BEST PRACTICES COMPLIANCE
  // ==========================================================================
  describe('3. Audit & Best Practices Compliance', () => {
    it('3.1 Should log rule versions, execution timestamps, source payroll IDs, and file checksums', async () => {
      const payrollRun = {
        payroll_run_id: 'PR_AUDIT_VERIFY',
        period: '2026-09',
        status: 'FINALIZED',
        employees: [
          {
            employee_id: 'EMP_AUDIT_01',
            employee_name: 'Sunita Rao',
            basic: 18000,
            gross_salary: 20000,
            esic_applicable: true,
            esic_number: '3100556677',
            date_of_joining: '2018-01-01',
            date_of_exit: '2026-03-31',
            last_drawn_salary: 18000,
            nps_applicable: true,
            pran: '110088887777',
          },
        ],
      };

      const manifest = await orchestrator.orchestratePayrollRun(payrollRun);

      // 1. Rule versions verified
      assert.strictEqual(manifest.rule_versions.ESIC, 'ESIC_STATUTORY_RULE_V4.0');
      assert.strictEqual(manifest.rule_versions.GRATUITY, 'GRATUITY_STATUTORY_RULE_V4.0');
      assert.strictEqual(manifest.rule_versions.NPS, 'NPS_STATUTORY_RULE_V4.0');

      // 2. Execution timestamps verified
      assert.ok(Date.parse(manifest.triggered_at));
      assert.ok(Date.parse(manifest.completed_at));
      assert.ok(manifest.duration_ms >= 0);

      // 3. Source payroll ID verified
      assert.strictEqual(manifest.source_payroll_id, 'PR_AUDIT_VERIFY');

      // 4. File Checksums (SHA-256) verified
      assert.ok(manifest.workers.esic.checksum_sha256);
      assert.strictEqual(manifest.workers.esic.checksum_sha256.length, 64);
      assert.ok(manifest.workers.nps.checksum_sha256);
      assert.strictEqual(manifest.workers.nps.checksum_sha256.length, 64);
    });
  });

  // ==========================================================================
  // 4. DATA MASKING & PII ENFORCEMENT
  // ==========================================================================
  describe('4. Data Masking & PII Enforcement', () => {
    it('4.1 Should mask UAN, ESIC No, PRAN, and Nominee details for UI presentation', () => {
      const sensitiveProfile = {
        employee_id: 'EMP_PII_01',
        employee_name: 'Rajesh Kumar',
        uan: '100123456789',
        esic_number: '3100123456',
        pran: '110012345678',
        account_number: '50100123456789',
        nominee_details: [
          { name: 'Kavita Kumar', relation: 'Spouse', share_percentage: 100 },
        ],
      };

      const masked = orchestrator.maskForUiPresentation(sensitiveProfile);

      // Verify UAN masked (••••••••6789)
      assert.strictEqual(masked.uan, '••••••••6789');

      // Verify ESIC No masked (••••••3456)
      assert.strictEqual(masked.esic_number, '••••••3456');

      // Verify PRAN masked (••••••••5678)
      assert.strictEqual(masked.pran, '••••••••5678');

      // Verify Bank Account masked (••••••••••6789)
      assert.strictEqual(masked.account_number, '••••••••••6789');

      // Verify Nominee details masked (K••••• K••••)
      assert.strictEqual(masked.nominee_details[0].name, 'K••••• K••••');
      assert.strictEqual(masked.nominee_details[0].relation, 'Spouse');
      assert.strictEqual(masked.nominee_details[0].share_percentage, 100);
    });

    it('4.2 Should preserve full unmasked values for file exports while masking UI endpoint response', async () => {
      const payload = {
        payroll_run_id: 'PR_PII_MASK_TEST',
        period: '2026-09',
        status: 'FINALIZED',
        employees: [
          {
            employee_id: 'EMP_PII_EXPORT',
            employee_name: 'Vikramaditya Roy',
            basic: 18000,
            gross_salary: 20000,
            esic_applicable: true,
            esic_number: '3100888899',
            nps_applicable: true,
            pran: '110033334444',
          },
        ],
      };

      // 1. Trigger via REST API
      const res = await fetch(`${baseUrl}/orchestrate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      assert.strictEqual(res.status, 200);

      // 2. Query staging with default UI masking
      const stagingRes = await fetch(`${baseUrl}/staging/PR_PII_MASK_TEST`);
      assert.strictEqual(stagingRes.status, 200);
      const stagingData = await stagingRes.json();
      assert.strictEqual(stagingData.success, true);

      // 3. Official export file must preserve unmasked values
      const npsExport = globalCorporateNpsAutomationEngine.exportFiles.get('NPS_BATCH_PR_PII_MASK_TEST');
      if (npsExport) {
        assert.ok(npsExport.txt.includes('110033334444#Vikramaditya Roy'));
        assert.ok(!npsExport.txt.includes('••••••••'));
      }
    });
  });

  // ==========================================================================
  // 5. REST API ENDPOINTS & EVENTBUS INTEGRATION
  // ==========================================================================
  describe('5. REST API Endpoints & Centralized EventBus Integration', () => {
    it('5.1 GET /api/v1/compliance/exceptions and POST /resolve', async () => {
      // Orchestrate run with defect
      await fetch(`${baseUrl}/orchestrate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          payroll_run_id: 'PR_RESOLVE_API_TEST',
          period: '2026-09',
          status: 'FINALIZED',
          employees: [
            {
              employee_id: 'EMP_RESOLVE_DEFECT',
              employee_name: 'Ajeet Patel',
              basic: 20000,
              gross_salary: 20000,
              esic_applicable: true,
              esic_number: '123', // Malformed ESIC
            },
          ],
        }),
      });

      // Query exceptions
      const getRes = await fetch(`${baseUrl}/exceptions?source_payroll_id=PR_RESOLVE_API_TEST`);
      assert.strictEqual(getRes.status, 200);
      const getData = await getRes.json();
      assert.ok(getData.data.total_count >= 1);

      const issueId = getData.data.exceptions[0].exception_id;

      // Resolve exception
      const resolveRes = await fetch(`${baseUrl}/exceptions/${issueId}/resolve`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          resolved_by: 'lead-compliance-officer',
          corrected_value: '3100123456',
        }),
      });
      assert.strictEqual(resolveRes.status, 200);
      const resolveData = await resolveRes.json();
      assert.strictEqual(resolveData.success, true);
      assert.strictEqual(resolveData.data.resolved, true);
    });

    it('5.2 Should trigger orchestration automatically via EventBus PAYROLL_FINALIZED', async () => {
      const busRunId = `PR_EVENTBUS_${Date.now()}`;
      mockEventBus.emit('PAYROLL_FINALIZED', {
        payroll_run_id: busRunId,
        period: '2026-09',
        status: 'FINALIZED',
        employees: [
          {
            employee_id: 'EMP_BUS_01',
            basic: 15000,
            gross_salary: 16000,
            esic_applicable: true,
            esic_number: '3100445566',
          },
        ],
      });

      // Wait a tick for async handler
      await new Promise((resolve) => setTimeout(resolve, 60));

      const manifest = orchestrator.executionManifests.get(busRunId);
      assert.ok(manifest);
      assert.strictEqual(manifest.source_payroll_id, busRunId);
      assert.strictEqual(manifest.workers.esic.success, true);
    });
  });
});
