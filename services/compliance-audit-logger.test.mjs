/**
 * ============================================================================
 * KYLRX AI ENTERPRISE HRMS — CENTRALIZED COMPLIANCE AUDIT LOGGER TEST SUITE
 * CRITERION 11: IMMUTABLE EVENT STREAMING, EVENT SCHEMA & AUDIT QUERY API
 * ============================================================================
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import express from 'express';

import {
  ComplianceAuditStream,
  globalComplianceAuditStream,
  correlationPropagationMiddleware,
  normalizeEntityType,
  resolveDefaultRuleVersion,
  resolveDefaultActorRole,
} from './compliance-audit-logger.mjs';

import {
  createDisbursementApiRouter,
  resetDisbursementMicroserviceStores,
  recordStateTransition,
  AuditService,
  PayrollService,
  PaymentBatchService,
  ApprovalService,
  store,
} from './payroll-disbursement-api.mjs';

test('📜 CRITERION 11: CENTRALIZED COMPLIANCE AUDIT LOGGER TEST SUITE', async (t) => {
  // ==========================================================================
  // 1. IMMUTABLE EVENT STREAMING
  // ==========================================================================
  await t.test('1. Immutable Event Streaming Engine', async (t2) => {
    await t2.test('1.1 Appends events sequentially to append-only stream and enforces deep immutability', () => {
      const stream = new ComplianceAuditStream();

      const event = stream.appendEvent({
        entity_type: 'PayrollRun',
        entity_id: 'RUN_2026_09',
        from_state: 'DRAFT',
        to_state: 'FINALIZED',
        actor_id: 'admin@kylrx.ai',
        actor_role: 'PAYROLL_ADMIN',
        rule_version_applied: 'PAYROLL_STATUTORY_V2026.09',
        correlation_id: 'corr_test_001',
      });

      assert.equal(stream.size, 1);
      assert.ok(Object.isFrozen(event), 'Audit event must be frozen with Object.freeze');

      // Mutating properties must fail or throw in strict mode
      assert.throws(() => {
        event.to_state = 'MUTATED';
      }, /Cannot assign to read only property/);

      assert.throws(() => {
        event.metadata.hacked = true;
      }, /Cannot add property/);

      // Verify second append creates monotonic sequence
      const event2 = stream.appendEvent({
        entity_type: 'PaymentBatch',
        entity_id: 'BATCH_SAL_001',
        from_state: 'VALIDATED',
        to_state: 'APPROVED',
        actor_id: 'checker@kylrx.ai',
        actor_role: 'CHECKER',
        rule_version_applied: 'RBI_NEFT_RTGS_STATUTORY_V1',
        correlation_id: 'corr_test_001',
      });

      assert.equal(stream.size, 2);
      const allEvents = stream.getAllEvents();
      assert.equal(allEvents.length, 2);
      assert.equal(allEvents[0].event_id, event.event_id);
      assert.equal(allEvents[1].event_id, event2.event_id);
    });

    await t2.test('1.2 Emits real-time streaming events to subscribers via EventEmitter', () => {
      const stream = new ComplianceAuditStream();
      const emittedEvents = [];
      const entitySpecificEvents = [];

      stream.on('audit_event', (evt) => {
        emittedEvents.push(evt);
      });

      stream.on('entity:ComplianceReturn', (evt) => {
        entitySpecificEvents.push(evt);
      });

      stream.appendEvent({
        entity_type: 'ComplianceReturn',
        entity_id: 'CR_ESIC_2026_09',
        from_state: 'VALIDATED',
        to_state: 'FILE_GENERATED',
        actor_id: 'compliance_bot',
        actor_role: 'SYSTEM_SERVICE',
        rule_version_applied: 'ESIC_STATUTORY_V1',
        correlation_id: 'corr_stream_01',
      });

      stream.appendEvent({
        entity_type: 'PayrollRun',
        entity_id: 'RUN_TEST_99',
        from_state: 'DRAFT',
        to_state: 'FINALIZED',
        actor_id: 'admin',
        actor_role: 'PAYROLL_ADMIN',
        correlation_id: 'corr_stream_02',
      });

      assert.equal(emittedEvents.length, 2);
      assert.equal(entitySpecificEvents.length, 1);
      assert.equal(entitySpecificEvents[0].entity_id, 'CR_ESIC_2026_09');
    });
  });

  // ==========================================================================
  // 2. EVENT SCHEMA CONFORMANCE
  // ==========================================================================
  await t.test('2. Event Schema Conformance', async (t2) => {
    await t2.test('2.1 Captures all mandatory Criterion 11 fields across PayrollRun, PaymentBatch, and ComplianceReturn', () => {
      const stream = new ComplianceAuditStream();

      // PayrollRun event
      const runEvt = stream.appendEvent({
        entity_type: 'PayrollRun',
        entity_id: 'RUN_OCT_2026',
        from_state: 'DRAFT',
        to_state: 'FINALIZED',
        actor_id: 'payroll_head',
        actor_role: 'PAYROLL_ADMIN',
        rule_version_applied: 'PAYROLL_STATUTORY_V2026.09',
        correlation_id: 'corr_flow_101',
      });

      assert.ok(runEvt.event_id.startsWith('evt_'));
      assert.equal(runEvt.entity_type, 'PayrollRun');
      assert.equal(runEvt.entity_id, 'RUN_OCT_2026');
      assert.equal(runEvt.from_state, 'DRAFT');
      assert.equal(runEvt.to_state, 'FINALIZED');
      assert.equal(runEvt.actor_id, 'payroll_head');
      assert.equal(runEvt.actor_role, 'PAYROLL_ADMIN');
      assert.ok(!isNaN(new Date(runEvt.timestamp).getTime()));
      assert.equal(runEvt.rule_version_applied, 'PAYROLL_STATUTORY_V2026.09');
      assert.equal(runEvt.correlation_id, 'corr_flow_101');

      // PaymentBatch event
      const batchEvt = stream.appendEvent({
        entity_type: 'PaymentBatch',
        entity_id: 'BATCH_PF_2026_09',
        from_state: 'PENDING_APPROVAL',
        to_state: 'APPROVED',
        actor_id: 'checker_swati@kylrx.ai',
        actor_role: 'CHECKER',
        rule_version_applied: 'EPFO_ECR_2026_V1',
        correlation_id: 'corr_flow_101',
      });

      assert.equal(batchEvt.entity_type, 'PaymentBatch');
      assert.equal(batchEvt.entity_id, 'BATCH_PF_2026_09');
      assert.equal(batchEvt.from_state, 'PENDING_APPROVAL');
      assert.equal(batchEvt.to_state, 'APPROVED');
      assert.equal(batchEvt.actor_id, 'checker_swati@kylrx.ai');
      assert.equal(batchEvt.actor_role, 'CHECKER');
      assert.equal(batchEvt.rule_version_applied, 'EPFO_ECR_2026_V1');
      assert.equal(batchEvt.correlation_id, 'corr_flow_101');

      // ComplianceReturn event
      const returnEvt = stream.appendEvent({
        entity_type: 'ComplianceReturn',
        entity_id: 'CR_NPS_2026_09',
        from_state: 'DRAFT',
        to_state: 'VALIDATED',
        actor_id: 'nps_engine',
        actor_role: 'SYSTEM_SERVICE',
        rule_version_applied: 'NPS_PFRDA_CRA_2026_V1',
        correlation_id: 'corr_flow_101',
      });

      assert.equal(returnEvt.entity_type, 'ComplianceReturn');
      assert.equal(returnEvt.entity_id, 'CR_NPS_2026_09');
      assert.equal(returnEvt.from_state, 'DRAFT');
      assert.equal(returnEvt.to_state, 'VALIDATED');
      assert.equal(returnEvt.rule_version_applied, 'NPS_PFRDA_CRA_2026_V1');
    });

    await t2.test('2.2 Rejects event creation with missing mandatory fields', () => {
      const stream = new ComplianceAuditStream();

      // Missing entity_type
      assert.throws(() => {
        stream.appendEvent({
          entity_id: 'ID_01',
          to_state: 'STATE_A',
        });
      }, /entity_type.*mandatory/);

      // Missing entity_id
      assert.throws(() => {
        stream.appendEvent({
          entity_type: 'PayrollRun',
          to_state: 'STATE_A',
        });
      }, /entity_id.*mandatory/);

      // Missing to_state
      assert.throws(() => {
        stream.appendEvent({
          entity_type: 'PayrollRun',
          entity_id: 'ID_01',
        });
      }, /to_state.*mandatory/);
    });

    await t2.test('2.3 Preserves backward-compatible aliases (transition_id, entity, from, to)', () => {
      const stream = new ComplianceAuditStream();
      const event = stream.appendEvent({
        entity: 'payroll_run',
        entityId: 'RUN_BACKWARD',
        from: 'CALCULATING',
        to: 'FINALIZED',
        actorId: 'admin',
      });

      assert.equal(event.transition_id, event.event_id);
      assert.equal(event.entity, 'payroll_run');
      assert.equal(event.from, 'CALCULATING');
      assert.equal(event.to, 'FINALIZED');
    });
  });

  // ==========================================================================
  // 3. DISTRIBUTED CORRELATION PROPAGATION
  // ==========================================================================
  await t.test('3. Distributed Correlation ID Propagation Across Multi-Step Lifecycle', async (t2) => {
    await t2.test('3.1 Preserves identical correlation_id across multi-entity transaction flows', () => {
      const stream = new ComplianceAuditStream();
      const sharedCorrelationId = 'corr_distributed_payroll_flow_20260905_xyz';

      // Step 1: Finalize payroll run
      stream.appendEvent({
        entity_type: 'PayrollRun',
        entity_id: 'RUN_2026_09',
        from_state: 'DRAFT',
        to_state: 'FINALIZED',
        actor_id: 'payroll_lead',
        correlation_id: sharedCorrelationId,
      });

      // Step 2: Create payment batch
      stream.appendEvent({
        entity_type: 'PaymentBatch',
        entity_id: 'BATCH_SAL_2026_09',
        from_state: null,
        to_state: 'DRAFT',
        actor_id: 'payroll_lead',
        correlation_id: sharedCorrelationId,
      });

      // Step 3: Submit batch for approval
      stream.appendEvent({
        entity_type: 'PaymentBatch',
        entity_id: 'BATCH_SAL_2026_09',
        from_state: 'DRAFT',
        to_state: 'PENDING_APPROVAL',
        actor_id: 'maker_user@kylrx.ai',
        actor_role: 'MAKER',
        correlation_id: sharedCorrelationId,
      });

      // Step 4: Checker approves batch
      stream.appendEvent({
        entity_type: 'PaymentBatch',
        entity_id: 'BATCH_SAL_2026_09',
        from_state: 'PENDING_APPROVAL',
        to_state: 'APPROVED',
        actor_id: 'checker_user@kylrx.ai',
        actor_role: 'CHECKER',
        correlation_id: sharedCorrelationId,
      });

      // Step 5: Export bank file
      stream.appendEvent({
        entity_type: 'PaymentBatch',
        entity_id: 'BATCH_SAL_2026_09',
        from_state: 'APPROVED',
        to_state: 'FILE_GENERATED',
        actor_id: 'file_engine',
        actor_role: 'SYSTEM_SERVICE',
        correlation_id: sharedCorrelationId,
      });

      // Step 6: ESIC Return Generation
      stream.appendEvent({
        entity_type: 'ComplianceReturn',
        entity_id: 'CR_ESIC_2026_09',
        from_state: 'DRAFT',
        to_state: 'FILE_GENERATED',
        actor_id: 'compliance_officer',
        actor_role: 'STATUTORY_ADMIN',
        correlation_id: sharedCorrelationId,
      });

      // Query stream by distributed correlation ID
      const queryResult = stream.queryEvents({ correlation_id: sharedCorrelationId });
      assert.equal(queryResult.total, 6);
      assert.equal(queryResult.events.length, 6);

      // Verify all 6 events share exact correlation ID
      for (const evt of queryResult.events) {
        assert.equal(evt.correlation_id, sharedCorrelationId);
      }

      // Verify span covers PayrollRun, PaymentBatch, and ComplianceReturn
      const entityTypes = new Set(queryResult.events.map((e) => e.entity_type));
      assert.ok(entityTypes.has('PayrollRun'));
      assert.ok(entityTypes.has('PaymentBatch'));
      assert.ok(entityTypes.has('ComplianceReturn'));
    });
  });

  // ==========================================================================
  // 4. AUDIT QUERY API (INDEXED LOOKUPS & DATE RANGES)
  // ==========================================================================
  await t.test('4. High-Performance Indexed Lookups & Query Engine', async (t2) => {
    const stream = new ComplianceAuditStream();

    const t0 = new Date('2026-09-01T10:00:00.000Z').getTime();
    const t1 = new Date('2026-09-02T10:00:00.000Z').getTime();
    const t2Date = new Date('2026-09-03T10:00:00.000Z').getTime();
    const t3 = new Date('2026-09-04T10:00:00.000Z').getTime();

    // Populate test events across dates and entities
    stream.appendEvent({
      entity_type: 'PayrollRun',
      entity_id: 'RUN_A',
      from_state: 'DRAFT',
      to_state: 'FINALIZED',
      actor_id: 'admin_1',
      actor_role: 'PAYROLL_ADMIN',
      correlation_id: 'corr_alpha',
      timestamp: new Date(t0).toISOString(),
    });

    stream.appendEvent({
      entity_type: 'PaymentBatch',
      entity_id: 'BATCH_A',
      from_state: 'DRAFT',
      to_state: 'APPROVED',
      actor_id: 'checker_1',
      actor_role: 'CHECKER',
      correlation_id: 'corr_alpha',
      timestamp: new Date(t1).toISOString(),
    });

    stream.appendEvent({
      entity_type: 'PaymentBatch',
      entity_id: 'BATCH_B',
      from_state: 'DRAFT',
      to_state: 'RECONCILING',
      actor_id: 'recon_bot',
      actor_role: 'SYSTEM_SERVICE',
      correlation_id: 'corr_beta',
      timestamp: new Date(t2Date).toISOString(),
    });

    stream.appendEvent({
      entity_type: 'ComplianceReturn',
      entity_id: 'CR_ESIC_01',
      from_state: 'VALIDATED',
      to_state: 'FILE_GENERATED',
      actor_id: 'compliance_officer',
      actor_role: 'STATUTORY_ADMIN',
      correlation_id: 'corr_gamma',
      timestamp: new Date(t3).toISOString(),
    });

    await t2.test('4.1 Lookups by entity_type (case-insensitive with normalization)', () => {
      const resRuns = stream.queryEvents({ entity_type: 'payroll_run' });
      assert.equal(resRuns.total, 1);
      assert.equal(resRuns.events[0].entity_id, 'RUN_A');

      const resBatches = stream.queryEvents({ entity_type: 'PAYMENT_BATCH' });
      assert.equal(resBatches.total, 2);

      const resReturns = stream.queryEvents({ entity_type: 'ComplianceReturn' });
      assert.equal(resReturns.total, 1);
      assert.equal(resReturns.events[0].entity_id, 'CR_ESIC_01');
    });

    await t2.test('4.2 Lookups by exact entity_id', () => {
      const res = stream.queryEvents({ entity_id: 'BATCH_B' });
      assert.equal(res.total, 1);
      assert.equal(res.events[0].to_state, 'RECONCILING');
    });

    await t2.test('4.3 Lookups by correlation_id', () => {
      const res = stream.queryEvents({ correlation_id: 'corr_alpha' });
      assert.equal(res.total, 2);
      assert.deepEqual(
        res.events.map((e) => e.entity_id),
        ['RUN_A', 'BATCH_A']
      );
    });

    await t2.test('4.4 Lookups by ISO Date Ranges', () => {
      // Range covers t1 and t2 (September 2 to September 3)
      const resRange = stream.queryEvents({
        from_date: '2026-09-02T00:00:00.000Z',
        to_date: '2026-09-03T23:59:59.000Z',
      });
      assert.equal(resRange.total, 2);
      assert.equal(resRange.events[0].entity_id, 'BATCH_A');
      assert.equal(resRange.events[1].entity_id, 'BATCH_B');

      // Range before all events
      const resEmpty = stream.queryEvents({
        to_date: '2026-08-31T23:59:59.000Z',
      });
      assert.equal(resEmpty.total, 0);
    });

    await t2.test('4.5 Pagination support (limit and offset)', () => {
      const page1 = stream.queryEvents({ limit: 2, offset: 0 });
      assert.equal(page1.total, 4);
      assert.equal(page1.count, 2);
      assert.equal(page1.events[0].entity_id, 'RUN_A');
      assert.equal(page1.events[1].entity_id, 'BATCH_A');

      const page2 = stream.queryEvents({ limit: 2, offset: 2 });
      assert.equal(page2.total, 4);
      assert.equal(page2.count, 2);
      assert.equal(page2.events[0].entity_id, 'BATCH_B');
      assert.equal(page2.events[1].entity_id, 'CR_ESIC_01');
    });
  });

  // ==========================================================================
  // 5. REST API ENDPOINTS INTEGRATION (GET /api/v1/audit)
  // ==========================================================================
  await t.test('5. REST API Integration: GET /api/v1/audit', async (t2) => {
    resetDisbursementMicroserviceStores();

    const app = express();
    const router = createDisbursementApiRouter();
    app.use(router);

    const server = http.createServer(app);
    await new Promise((resolve) => server.listen(0, resolve));
    const port = server.address().port;
    const baseUrl = `http://127.0.0.1:${port}`;

    try {
      // 1. Seed events through API state transitions
      const testCorrId = 'corr_api_test_999';

      recordStateTransition({
        entity_type: 'PayrollRun',
        entity_id: 'RUN_API_01',
        from_state: 'DRAFT',
        to_state: 'FINALIZED',
        actor_id: 'admin_api',
        actor_role: 'PAYROLL_ADMIN',
        correlation_id: testCorrId,
        rule_version_applied: 'PAYROLL_STATUTORY_V2026.09',
      });

      recordStateTransition({
        entity_type: 'PaymentBatch',
        entity_id: 'BATCH_API_01',
        from_state: 'PENDING_APPROVAL',
        to_state: 'APPROVED',
        actor_id: 'checker_api',
        actor_role: 'CHECKER',
        correlation_id: testCorrId,
        rule_version_applied: 'RBI_NEFT_RTGS_STATUTORY_V1',
      });

      recordStateTransition({
        entity_type: 'ComplianceReturn',
        entity_id: 'CR_ESIC_API_01',
        from_state: 'VALIDATED',
        to_state: 'FILE_GENERATED',
        actor_id: 'compliance_api',
        actor_role: 'STATUTORY_ADMIN',
        correlation_id: 'corr_other_111',
        rule_version_applied: 'ESIC_STATUTORY_V1',
      });

      await t2.test('5.1 GET /api/v1/audit returns 200 with OpenAPI envelope and correlation header', async () => {
        const res = await fetch(`${baseUrl}/api/v1/audit`, {
          headers: {
            'x-correlation-id': 'corr_client_req_001',
          },
        });

        assert.equal(res.status, 200);
        assert.equal(res.headers.get('x-correlation-id'), 'corr_client_req_001');

        const body = await res.json();
        assert.equal(body.success, true);
        assert.ok(body.data);
        assert.equal(body.data.total >= 3, true);
        assert.ok(Array.isArray(body.data.events));
      });

      await t2.test('5.2 GET /api/v1/audit filters by correlation_id across entities', async () => {
        const res = await fetch(`${baseUrl}/api/v1/audit?correlation_id=${testCorrId}`);
        assert.equal(res.status, 200);

        const body = await res.json();
        assert.equal(body.success, true);
        assert.equal(body.data.total, 2);
        assert.equal(body.data.events[0].entity_id, 'RUN_API_01');
        assert.equal(body.data.events[1].entity_id, 'BATCH_API_01');
      });

      await t2.test('5.3 GET /api/v1/audit filters by entity_type', async () => {
        const res = await fetch(`${baseUrl}/api/v1/audit?entity_type=ComplianceReturn`);
        assert.equal(res.status, 200);

        const body = await res.json();
        assert.equal(body.success, true);
        assert.equal(body.data.total, 1);
        assert.equal(body.data.events[0].entity_id, 'CR_ESIC_API_01');
      });

      await t2.test('5.4 GET /api/v1/audit filters by entity_id', async () => {
        const res = await fetch(`${baseUrl}/api/v1/audit?entity_id=RUN_API_01`);
        assert.equal(res.status, 200);

        const body = await res.json();
        assert.equal(body.success, true);
        assert.equal(body.data.total, 1);
        assert.equal(body.data.events[0].to_state, 'FINALIZED');
      });

      await t2.test('5.5 GET /api/v1/audit filters by ISO date range', async () => {
        const past = new Date(Date.now() - 3600000).toISOString();
        const future = new Date(Date.now() + 3600000).toISOString();

        const res = await fetch(`${baseUrl}/api/v1/audit?from_date=${past}&to_date=${future}`);
        assert.equal(res.status, 200);

        const body = await res.json();
        assert.equal(body.success, true);
        assert.ok(body.data.total >= 3);
      });

      await t2.test('5.6 Backward-compatible alias GET /audit still functions as expected', async () => {
        const res = await fetch(`${baseUrl}/audit?correlation_id=${testCorrId}`);
        assert.equal(res.status, 200);

        const body = await res.json();
        assert.equal(body.success, true);
        assert.equal(body.data.total, 2);
      });
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  });
});
