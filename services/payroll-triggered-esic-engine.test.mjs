/**
 * ============================================================================
 * KYLRX AI ENTERPRISE HRMS - PAYROLL-TRIGGERED ESIC ENGINE TEST SUITE
 * ============================================================================
 * Automated Unit & Integration Tests for:
 *  1. Event Trigger & Eligibility Filtering (esic_applicable, standard vs disabled)
 *  2. Dynamic Rate Calculation & Statutory Rounding
 *  3. Exception Gating (EMP038 Malformed IP, EMP039 Wage Ceiling Breach)
 *  4. Grandfathering Exemption Support
 *  5. HR Task Queue Automation & Compliant Payload Isolation
 *  6. End-to-End EventBus Integration
 *
 * @version 3.2.0
 * @author Kylrx AI Principal QA & Systems Architecture Team
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  executePayrollEsicEngine,
  registerPayrollFinalizedEsicListener,
} from './payroll-triggered-esic-engine.mjs';
import EventEmitter from 'node:events';

describe('⚡ KYLRX AI PAYROLL-TRIGGERED ESIC CALCULATION ENGINE TEST SUITE', () => {

  describe('1. Eligibility Filtering & Applicable Flag Gating', () => {
    it('Should process only records where esic_applicable === true and exclude non-applicable personnel', async () => {
      const records = [
        { employee_id: 'EMP_APP_01', gross_wages: 18000, esic_applicable: true, esic_number: '3100012345' },
        { employee_id: 'EMP_EXEMPT_01', gross_wages: 45000, esic_applicable: false },
        { employee_id: 'EMP_EXEMPT_02', gross_wages: 15000, esic_applicable: false },
      ];

      const result = await executePayrollEsicEngine({
        run_id: 'RUN-SEP-2026-001',
        period: 'September 2026',
        payroll_records: records,
      });

      assert.strictEqual(result.status, 'COMPLETED');
      assert.strictEqual(result.summary.total_records_processed, 3);
      assert.strictEqual(result.summary.total_applicable_candidates, 1);
      assert.strictEqual(result.compliant_records.length, 1);
      assert.strictEqual(result.non_applicable_records.length, 2);
      assert.strictEqual(result.compliant_records[0].employee_id, 'EMP_APP_01');
    });

    it('Should correctly evaluate disability_flag and apply ₹25,000 ceiling instead of ₹21,000', async () => {
      const records = [
        {
          employee_id: 'EMP_DIS_01',
          employee_name: 'Vikram Singh',
          gross_wages: 23500, // > 21k, but <= 25k
          esic_applicable: true,
          esic_number: '3100088888',
          disability_flag: true,
        },
      ];

      const result = await executePayrollEsicEngine({
        run_id: 'RUN-SEP-2026-002',
        period: 'September 2026',
        payroll_records: records,
      });

      assert.strictEqual(result.status, 'COMPLETED');
      assert.strictEqual(result.compliant_records.length, 1);
      const rec = result.compliant_records[0];
      assert.strictEqual(rec.is_disabled_scheme, true);
      assert.strictEqual(rec.applicable_wage_ceiling, 25000);
      assert.strictEqual(result.blocking_issues.length, 0);
    });
  });

  describe('2. Dynamic Rate Calculation & Rounding Engine', () => {
    it('Should calculate exact 0.75% EE and 3.25% ER contributions with whole-rupee rounding', async () => {
      const records = [
        {
          employee_id: 'EMP_01',
          employee_name: 'Rahul Sharma',
          gross_wages: 19750,
          esic_applicable: true,
          esic_number: '3100012345',
        },
      ];

      // Gross = ₹19,750
      // EE = 19750 * 0.0075 = 148.125 -> Math.round: ₹148
      // ER = 19750 * 0.0325 = 641.875 -> Math.round: ₹642
      // Total Challan = 148 + 642 = ₹790
      const result = await executePayrollEsicEngine({
        run_id: 'RUN-SEP-2026-003',
        period: 'September 2026',
        payroll_records: records,
      });

      assert.strictEqual(result.status, 'COMPLETED');
      assert.strictEqual(result.summary.total_statutory_wages, 19750);
      assert.strictEqual(result.summary.total_employee_deductions, 148);
      assert.strictEqual(result.summary.total_employer_contributions, 642);
      assert.strictEqual(result.summary.total_challan_liability, 790);

      const item = result.compliant_records[0];
      assert.strictEqual(item.employee_deduction, 148);
      assert.strictEqual(item.employer_contribution, 642);
      assert.strictEqual(item.total_challan_amount, 790);
    });
  });

  describe('3. Exception Gating: Malformed ESIC Numbers & Wage Limit Breaches', () => {
    it('Should create blocking ValidationIssue (EMP038) and HR task when 10-digit ESIC number is missing or invalid', async () => {
      const records = [
        {
          employee_id: 'EMP_BAD_IP',
          employee_name: 'Pooja Verma',
          gross_wages: 16000,
          esic_applicable: true,
          esic_number: '31000123', // Invalid length (8 digits)
        },
      ];

      const result = await executePayrollEsicEngine({
        run_id: 'RUN-SEP-2026-004',
        period: 'September 2026',
        payroll_records: records,
      });

      assert.strictEqual(result.status, 'REQUIRES_REMEDIATION');
      assert.strictEqual(result.is_valid, false);
      assert.strictEqual(result.compliant_records.length, 0); // Excluded from return payload
      assert.strictEqual(result.blocking_issues.length, 1);
      assert.strictEqual(result.hr_tasks_created.length, 1);

      const issue = result.blocking_issues[0];
      assert.strictEqual(issue.code, 'EMP038');
      assert.strictEqual(issue.severity, 'BLOCK');
      assert.strictEqual(issue.field, 'esic_number');
      assert.ok(issue.message.includes('missing or invalid 10-digit statutory ESIC/IP number'));

      const task = result.hr_tasks_created[0];
      assert.strictEqual(task.assignee_role, 'HR_COMPLIANCE_OFFICER');
      assert.strictEqual(task.priority, 'HIGH');
      assert.strictEqual(task.action_required, 'UPDATE_ESIC_IP_NUMBER');
    });

    it('Should create blocking ValidationIssue (EMP039) when wages exceed ₹21,000 without grandfathering', async () => {
      const records = [
        {
          employee_id: 'EMP_WAGE_BREACH',
          employee_name: 'Ananya Roy',
          gross_wages: 22500, // Exceeds 21,000 standard ceiling
          esic_applicable: true,
          esic_number: '3100077777',
          disability_flag: false,
          is_grandfathered: false,
        },
      ];

      const result = await executePayrollEsicEngine({
        run_id: 'RUN-SEP-2026-005',
        period: 'September 2026',
        payroll_records: records,
      });

      assert.strictEqual(result.status, 'REQUIRES_REMEDIATION');
      assert.strictEqual(result.compliant_records.length, 0); // Excluded
      assert.strictEqual(result.blocking_issues.length, 1);

      const issue = result.blocking_issues[0];
      assert.strictEqual(issue.code, 'EMP039');
      assert.strictEqual(issue.severity, 'BLOCK');
      assert.strictEqual(issue.field, 'gross_wages');
      assert.ok(issue.message.includes('exceed the active ESIC wage ceiling (₹21000)'));

      const task = result.hr_tasks_created[0];
      assert.strictEqual(task.action_required, 'ACKNOWLEDGE_CEILING_OR_EXEMPT');
    });

    it('Should allow employee with wages exceeding ceiling if is_grandfathered === true (Half-Yearly Cycle Rule)', async () => {
      const records = [
        {
          employee_id: 'EMP_GRANDFATHERED',
          employee_name: 'Deepak Patel',
          gross_wages: 23000, // Exceeds ceiling mid-cycle
          esic_applicable: true,
          esic_number: '3100055555',
          disability_flag: false,
          is_grandfathered: true, // Grandfathered for contribution period
        },
      ];

      const result = await executePayrollEsicEngine({
        run_id: 'RUN-SEP-2026-006',
        period: 'September 2026',
        payroll_records: records,
      });

      assert.strictEqual(result.status, 'COMPLETED');
      assert.strictEqual(result.blocking_issues.length, 0);
      assert.strictEqual(result.compliant_records.length, 1);
      assert.strictEqual(result.compliant_records[0].is_grandfathered, true);
    });
  });

  describe('4. Mixed Batch Processing & Task Dispatcher Hook', () => {
    it('Should isolate clean compliant records into return payload while capturing all exceptions and tasks', async () => {
      const dispatchedTasks = [];
      const mockDispatcher = {
        async dispatchTasks(tasks) {
          dispatchedTasks.push(...tasks);
        },
      };

      const records = [
        { employee_id: 'E1', gross_wages: 15000, esic_applicable: true, esic_number: '3100011111' }, // Clean
        { employee_id: 'E2', gross_wages: 16000, esic_applicable: true, esic_number: 'BAD' }, // Malformed ESIC
        { employee_id: 'E3', gross_wages: 28000, esic_applicable: true, esic_number: '3100033333' }, // Wage ceiling breach
        { employee_id: 'E4', gross_wages: 24000, esic_applicable: true, esic_number: '3100044444', disability_flag: true }, // Clean (Disabled)
        { employee_id: 'E5', gross_wages: 50000, esic_applicable: false }, // Non-applicable
      ];

      const result = await executePayrollEsicEngine({
        run_id: 'RUN-SEP-2026-007',
        period: 'September 2026',
        payroll_records: records,
        task_dispatcher: mockDispatcher,
      });

      assert.strictEqual(result.status, 'REQUIRES_REMEDIATION');
      assert.strictEqual(result.summary.total_records_processed, 5);
      assert.strictEqual(result.summary.total_applicable_candidates, 4);
      assert.strictEqual(result.summary.total_compliant_ips, 2); // E1 and E4
      assert.strictEqual(result.summary.total_blocked_exceptions, 2); // E2 and E3
      assert.strictEqual(dispatchedTasks.length, 2);
    });
  });

  describe('5. End-to-End EventBus PAYROLL_FINALIZED Listener Integration', () => {
    it('Should automatically trigger ESIC engine on PAYROLL_FINALIZED event', async () => {
      const mockEventBus = new EventEmitter();
      let completedResult = null;

      registerPayrollFinalizedEsicListener(mockEventBus, {
        onComplete: (res) => {
          completedResult = res;
        },
      });

      const eventPayload = {
        run_id: 'RUN-AUTO-EVENT-2026',
        period: 'September 2026',
        payroll_records: [
          { employee_id: 'EMP_EVT_01', gross_wages: 18500, esic_applicable: true, esic_number: '3100099999' },
        ],
      };

      mockEventBus.emit('PAYROLL_FINALIZED', eventPayload);

      // Wait brief tick for async event execution
      await new Promise((resolve) => setTimeout(resolve, 50));

      assert.ok(completedResult);
      assert.strictEqual(completedResult.run_id, 'RUN-AUTO-EVENT-2026');
      assert.strictEqual(completedResult.status, 'COMPLETED');
      assert.strictEqual(completedResult.compliant_records.length, 1);
    });
  });

});
