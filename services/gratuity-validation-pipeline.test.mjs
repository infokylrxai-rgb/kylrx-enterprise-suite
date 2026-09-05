/**
 * ============================================================================
 * TEST SUITE: GRATUITY VALIDATION PIPELINE & EXCEPTION INTERCEPTOR
 * ============================================================================
 * Tests:
 *  1. Pre-Flight Validation: Inverted dates, negative/NaN salary, duplicates, incomplete nominees
 *  2. Vesting Gatekeeper Interception: Unvested tenure on resignation vs death/disability bypass
 *  3. Structured ValidationIssue & HR Task generation (code: 'GRAT_VAL_001', severity: 'BLOCK')
 *  4. Disbursement Workflow Guardrails: is_blocked and can_disburse flags
 *  5. Mixed Batch Processing & Stage Isolation
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  validateGratuityRecordPreFlight,
  validateVestingEligibility,
  executeGratuityValidationPipeline,
  isValidCalendarDate,
} from './gratuity-validation-pipeline.mjs';
import { DEFAULT_GRATUITY_POLICIES } from './gratuity-policy-resolver-service.mjs';

describe('⚡ KYLRX AI GRATUITY VALIDATION PIPELINE & EXCEPTION INTERCEPTOR TEST SUITE', () => {

  const activePolicy = DEFAULT_GRATUITY_POLICIES[1]; // 2018 policy: ₹20L cap, 1825 days min

  describe('1. Pre-Flight Validation Rules', () => {
    it('Should flag logically inverted tenure dates (date_of_exit <= date_of_joining)', () => {
      const profile = {
        employee_id: 'EMP_INV_01',
        date_of_joining: '2025-01-01',
        date_of_exit: '2023-01-01', // Inverted
        last_drawn_basic: 50000,
        last_drawn_da: 10000,
        nominees: [{ nominee_name: 'Anita', relationship: 'SPOUSE', share_percentage: 100 }],
      };

      const issues = validateGratuityRecordPreFlight(profile, { batch_id: 'B1' });

      assert.ok(issues.length >= 1);
      const invertedIssue = issues.find((i) => i.sub_code === 'INVERTED_TENURE_DATES');
      assert.ok(invertedIssue);
      assert.equal(invertedIssue.code, 'GRAT_VAL_001');
      assert.equal(invertedIssue.severity, 'BLOCK');
      assert.equal(invertedIssue.field, 'date_of_exit');
    });

    it('Should flag non-existent calendar dates (e.g. Feb 30)', () => {
      assert.equal(isValidCalendarDate('2026-02-30'), false);
      assert.equal(isValidCalendarDate('2026-09-04'), true);

      const profile = {
        employee_id: 'EMP_BAD_DATE',
        date_of_joining: '2020-02-30', // Invalid
        date_of_exit: '2026-09-01',
        last_drawn_basic: 50000,
        last_drawn_da: 10000,
      };

      const issues = validateGratuityRecordPreFlight(profile, { batch_id: 'B1' });
      assert.ok(issues.some((i) => i.sub_code === 'INVALID_CALENDAR_DATE_JOINING'));
    });

    it('Should flag salary basis <= 0 or NaN', () => {
      const profileZero = {
        employee_id: 'EMP_ZERO_SAL',
        date_of_joining: '2020-01-01',
        date_of_exit: '2026-01-01',
        last_drawn_basic: 0,
        last_drawn_da: 0,
      };

      const issuesZero = validateGratuityRecordPreFlight(profileZero, { batch_id: 'B1' });
      assert.ok(issuesZero.some((i) => i.sub_code === 'INVALID_SALARY_BASIS'));

      const profileNaN = {
        employee_id: 'EMP_NAN_SAL',
        date_of_joining: '2020-01-01',
        date_of_exit: '2026-01-01',
        last_drawn_basic: 'INVALID_AMOUNT',
        last_drawn_da: 0,
      };

      const issuesNaN = validateGratuityRecordPreFlight(profileNaN, { batch_id: 'B1' });
      assert.ok(issuesNaN.some((i) => i.sub_code === 'INVALID_SALARY_BASIS'));
    });

    it('Should flag intra-batch duplicate settlement records for the same employee_id', () => {
      const seenBatchIds = new Set(['EMP_DUP_01']);
      const profile = {
        employee_id: 'EMP_DUP_01',
        date_of_joining: '2020-01-01',
        date_of_exit: '2026-01-01',
        last_drawn_basic: 50000,
        last_drawn_da: 0,
      };

      const issues = validateGratuityRecordPreFlight(profile, { batch_id: 'B1', seenBatchIds });
      assert.ok(issues.some((i) => i.sub_code === 'DUPLICATE_BATCH_SETTLEMENT'));
    });

    it('Should flag duplicate settlement when employee was already settled in historical registry', () => {
      const historicalSettlements = new Set(['EMP_HIST_01']);
      const profile = {
        employee_id: 'EMP_HIST_01',
        date_of_joining: '2020-01-01',
        date_of_exit: '2026-01-01',
        last_drawn_basic: 50000,
        last_drawn_da: 0,
      };

      const issues = validateGratuityRecordPreFlight(profile, { batch_id: 'B1', historicalSettlements });
      assert.ok(issues.some((i) => i.sub_code === 'PRIOR_SETTLEMENT_EXISTS'));
    });

    it('Should flag nominee percentage when sum does not equal exactly 100%', () => {
      const profile = {
        employee_id: 'EMP_NOM_MISMATCH',
        date_of_joining: '2020-01-01',
        date_of_exit: '2026-01-01',
        last_drawn_basic: 50000,
        last_drawn_da: 10000,
        nominees: [
          { nominee_name: 'Anita', relationship: 'SPOUSE', share_percentage: 60 },
          { nominee_name: 'Rahul', relationship: 'SON', share_percentage: 30 }, // Sum = 90%
        ],
      };

      const issues = validateGratuityRecordPreFlight(profile, { batch_id: 'B1' });
      const nomineeIssue = issues.find((i) => i.sub_code === 'NOMINEE_PERCENTAGE_MISMATCH');
      assert.ok(nomineeIssue);
      assert.equal(nomineeIssue.code, 'GRAT_VAL_001');
      assert.equal(nomineeIssue.severity, 'BLOCK');
    });

    it('Should flag missing nominee declaration in DEATH claim scenario', () => {
      const profile = {
        employee_id: 'EMP_DEATH_NO_NOMINEE',
        date_of_joining: '2020-01-01',
        date_of_exit: '2026-01-01',
        exit_reason: 'DEATH',
        last_drawn_basic: 50000,
        last_drawn_da: 10000,
        nominees: [],
      };

      const issues = validateGratuityRecordPreFlight(profile, { batch_id: 'B1' });
      assert.ok(issues.some((i) => i.sub_code === 'MISSING_DEATH_CLAIM_NOMINEES'));
    });
  });

  describe('2. Vesting Gatekeeper Interception', () => {
    it('Should create blocking ValidationIssue (GRAT_VAL_001) for unvested employee upon resignation', () => {
      const profile = {
        employee_id: 'EMP_UNVESTED',
        date_of_joining: '2024-01-01',
        date_of_exit: '2026-01-01', // 2 years (< 5 years)
        exit_reason: 'RESIGNATION',
      };

      const issues = validateVestingEligibility(profile, activePolicy, 'B1');

      assert.equal(issues.length, 1);
      assert.equal(issues[0].code, 'GRAT_VAL_001');
      assert.equal(issues[0].sub_code, 'NON_VESTED_TENURE_DEFECT');
      assert.equal(issues[0].severity, 'BLOCK');
      assert.match(issues[0].message, /below the statutory vesting threshold/);
    });

    it('Should pass unvested tenure without issues if exit reason is DEATH or DISABILITY (Bypass)', () => {
      const profileDeath = {
        employee_id: 'EMP_DEATH_PASS',
        date_of_joining: '2025-01-01',
        date_of_exit: '2026-01-01', // 1 year
        exit_reason: 'DEATH',
      };

      const issuesDeath = validateVestingEligibility(profileDeath, activePolicy, 'B1');
      assert.equal(issuesDeath.length, 0);

      const profileDisability = {
        employee_id: 'EMP_DISABILITY_PASS',
        date_of_joining: '2024-06-01',
        date_of_exit: '2026-01-01', // 1.5 years
        exit_reason: 'DISABILITY',
      };

      const issuesDisability = validateVestingEligibility(profileDisability, activePolicy, 'B1');
      assert.equal(issuesDisability.length, 0);
    });
  });

  describe('3. Batch Pipeline Orchestrator & Task Queue Dispatching', () => {
    it('Should block disbursement and dispatch HR tasks when records contain defects', () => {
      const records = [
        // 1. Clean Vested Record
        {
          employee_id: 'EMP_CLEAN_01',
          date_of_joining: '2019-01-01',
          date_of_exit: '2026-09-01',
          exit_reason: 'RESIGNATION',
          last_drawn_basic: 60000,
          last_drawn_da: 10000,
          nominees: [{ nominee_name: 'Pooja', relationship: 'SPOUSE', share_percentage: 100 }],
        },
        // 2. Inverted Dates Record
        {
          employee_id: 'EMP_DEFECT_02',
          date_of_joining: '2026-01-01',
          date_of_exit: '2020-01-01',
          exit_reason: 'RESIGNATION',
          last_drawn_basic: 50000,
          last_drawn_da: 0,
        },
        // 3. Unvested Resignation Record
        {
          employee_id: 'EMP_DEFECT_03',
          date_of_joining: '2024-01-01',
          date_of_exit: '2026-01-01',
          exit_reason: 'RESIGNATION',
          last_drawn_basic: 40000,
          last_drawn_da: 0,
        },
      ];

      const result = executeGratuityValidationPipeline({
        batch_id: 'BATCH_GRAT_TEST_001',
        records,
      });

      // Pipeline Status
      assert.equal(result.is_blocked, true);
      assert.equal(result.can_disburse, false);
      assert.equal(result.status, 'PARTIAL');
      assert.equal(result.total_records, 3);
      assert.equal(result.valid_count, 1);
      assert.equal(result.blocked_count, 2);

      // Verify Staged Settlements (only clean record staged)
      assert.equal(result.staged_settlements.length, 1);
      assert.equal(result.staged_settlements[0].employee_id, 'EMP_CLEAN_01');

      // Verify Blocking Issues
      assert.equal(result.blocking_issues.length, 2);
      assert.ok(result.blocking_issues.every((i) => i.code === 'GRAT_VAL_001' && i.severity === 'BLOCK'));

      // Verify Dispatched HR Tasks
      assert.equal(result.hr_tasks.length, 2);
      const hrTask = result.hr_tasks[0];
      assert.ok(hrTask.task_id.startsWith('task_hr_grat_'));
      assert.equal(hrTask.assigned_role, 'HR_STATUTORY_ADMIN');
      assert.equal(hrTask.status, 'PENDING_REVIEW');
      assert.equal(hrTask.priority, 'HIGH');
    });

    it('Should allow disbursement (can_disburse === true) when all records are 100% compliant', () => {
      const records = [
        {
          employee_id: 'EMP_PERFECT_01',
          date_of_joining: '2018-01-01',
          date_of_exit: '2026-01-01', // 8 years
          exit_reason: 'RETIREMENT',
          last_drawn_basic: 70000,
          last_drawn_da: 15000,
          nominees: [
            { nominee_name: 'Meena', relationship: 'SPOUSE', share_percentage: 50 },
            { nominee_name: 'Tarun', relationship: 'SON', share_percentage: 50 },
          ],
        },
        {
          employee_id: 'EMP_PERFECT_02',
          date_of_joining: '2025-01-01',
          date_of_exit: '2026-01-01', // 1 year (Death Bypass)
          exit_reason: 'DEATH',
          last_drawn_basic: 50000,
          last_drawn_da: 5000,
          nominees: [{ nominee_name: 'Kamla', relationship: 'MOTHER', share_percentage: 100 }],
        }
      ];

      const result = executeGratuityValidationPipeline({
        batch_id: 'BATCH_GRAT_PERFECT',
        records,
      });

      assert.equal(result.is_blocked, false);
      assert.equal(result.can_disburse, true);
      assert.equal(result.status, 'PASSED');
      assert.equal(result.valid_count, 2);
      assert.equal(result.blocked_count, 0);
      assert.equal(result.blocking_issues.length, 0);
      assert.equal(result.hr_tasks.length, 0);
      assert.equal(result.staged_settlements.length, 2);
    });
  });
});
