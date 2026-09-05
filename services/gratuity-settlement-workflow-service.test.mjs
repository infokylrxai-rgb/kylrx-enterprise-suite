/**
 * ============================================================================
 * TEST SUITE: GRATUITY SETTLEMENT EXPORT, STATEMENTS & APPROVAL WORKFLOW
 * ============================================================================
 * Tests:
 *  1. Employee Gratuity Statement rendering (HTML statement details & tables)
 *  2. Form I Statutory Notice rendering (statutory claim clauses & signatures)
 *  3. Maker-Checker Segregation of Duties (4-Eyes self-approval prevention)
 *  4. F&F Batch Integration (Queuing for final settlement disbursement)
 *  5. Corporate Gratuity Liability Ledger posting (GL-2200 Debit / GL-1100 Credit)
 */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  renderEmployeeGratuityStatement,
  renderFormINotice,
  GratuitySettlementWorkflowService,
  MakerCheckerSecurityViolationError,
  resetGratuityWorkflowStores,
} from './gratuity-settlement-workflow-service.mjs';
import { executeGratuityCalculationEngine } from './statutory-gratuity-calculation-engine.mjs';

describe('⚡ KYLRX AI GRATUITY SETTLEMENT STATEMENTS & APPROVAL WORKFLOW TEST SUITE', () => {

  let service;

  beforeEach(() => {
    resetGratuityWorkflowStores();
    service = new GratuitySettlementWorkflowService();
  });

  const sampleProfile = {
    employee_id: 'EMP_VIKRAM_001',
    employee_name: 'Vikram Malhotra',
    department: 'Engineering',
    designation: 'Staff Infrastructure Architect',
    date_of_joining: '2019-01-01',
    date_of_exit: '2026-09-01', // ~8 years statutory
    exit_reason: 'RESIGNATION',
    last_drawn_basic: 80000,
    last_drawn_da: 20000, // Total salary basis = 100,000
    nominees: [
      { nominee_name: 'Rohini Malhotra', relationship: 'SPOUSE', share_percentage: 60 },
      { nominee_name: 'Kabir Malhotra', relationship: 'SON', share_percentage: 40 },
    ],
  };

  const calculatedSettlement = executeGratuityCalculationEngine(sampleProfile).settlement;

  describe('1. Employee Gratuity Statement HTML Rendering', () => {
    it('Should render rich HTML statement with all required statutory and financial sections', () => {
      const html = renderEmployeeGratuityStatement(calculatedSettlement, sampleProfile, {
        company_name: 'Kylrx Technologies Private Limited',
      });

      assert.ok(html.includes('Kylrx Technologies Private Limited'));
      assert.ok(html.includes('STATUTORY GRATUITY SETTLEMENT STATEMENT') || html.includes('Statutory Gratuity Statement'));
      assert.ok(html.includes('EMP_VIKRAM_001'));
      assert.ok(html.includes('Vikram Malhotra'));
      assert.ok(html.includes('Engineering / Staff Infrastructure Architect'));
      assert.ok(html.includes('2019-01-01 to 2026-09-01'));
      assert.ok(html.includes('Statutory Years'));
      assert.ok(html.includes('₹1,00,000')); // Salary Basis
      assert.ok(html.includes('15 / 26 Multiplier'));
      assert.ok(html.includes('₹20,00,000')); // Tax free cap
      assert.ok(html.includes('Rohini Malhotra'));
      assert.ok(html.includes('60%'));
      assert.ok(html.includes('Kabir Malhotra'));
      assert.ok(html.includes('40%'));
    });
  });

  describe('2. Form I Notice Generator', () => {
    it('Should render standard statutory Form I Notice of Claim with pre-populated values', () => {
      const formHtml = renderFormINotice(calculatedSettlement, sampleProfile, {
        company_name: 'Kylrx Enterprise Suite',
        address: 'MG Road, Bengaluru',
      });

      assert.ok(formHtml.includes("FORM 'I'"));
      assert.ok(formHtml.includes('Notice of Claim for Gratuity'));
      assert.ok(formHtml.includes('Payment of Gratuity Act, 1972'));
      assert.ok(formHtml.includes('Vikram Malhotra'));
      assert.ok(formHtml.includes('EMP_VIKRAM_001'));
      assert.ok(formHtml.includes('2019-01-01'));
      assert.ok(formHtml.includes('2026-09-01 (RESIGNATION)'));
      assert.ok(formHtml.includes('Amount of gratuity claimed:'));
      assert.ok(formHtml.includes(calculatedSettlement.payable_gratuity_amount.toLocaleString('en-IN')));
    });
  });

  describe('3. Maker-Checker Segregation of Duties & Approval Gate', () => {
    it('Should submit settlement to PENDING_GRATUITY_APPROVAL with maker metadata', async () => {
      const submitted = await service.submitForApproval({
        batch_id: 'GRAT_BATCH_SEP26',
        settlement: calculatedSettlement,
        employee_profile: sampleProfile,
        maker_id: 'usr_maker_ananya',
        maker_name: 'Ananya Roy',
      });

      assert.ok(submitted.settlement_id.startsWith('grat_set_'));
      assert.equal(submitted.status, 'PENDING_GRATUITY_APPROVAL');
      assert.equal(submitted.maker_id, 'usr_maker_ananya');
      assert.equal(submitted.checker_id, null);
    });

    it('Should prevent self-approval when maker_id === checker_id (403 Forbidden)', async () => {
      const submitted = await service.submitForApproval({
        batch_id: 'GRAT_BATCH_SEP26',
        settlement: calculatedSettlement,
        employee_profile: sampleProfile,
        maker_id: 'usr_same_admin',
      });

      await assert.rejects(
        async () => {
          await service.approveGratuitySettlement({
            settlement_id: submitted.settlement_id,
            checker_id: 'usr_same_admin', // Self-approval attempt
          });
        },
        (err) => {
          assert.ok(err instanceof MakerCheckerSecurityViolationError);
          assert.equal(err.statusCode, 403);
          assert.match(err.message, /Maker-Checker Security Violation/);
          assert.equal(err.makerId, 'usr_same_admin');
          assert.equal(err.checkerId, 'usr_same_admin');
          return true;
        }
      );
    });

    it('Should allow independent checker to approve and transition state to POSTED_TO_FNF', async () => {
      const submitted = await service.submitForApproval({
        batch_id: 'GRAT_BATCH_SEP26',
        settlement: calculatedSettlement,
        employee_profile: sampleProfile,
        maker_id: 'usr_maker_priya',
      });

      const approval = await service.approveGratuitySettlement({
        settlement_id: submitted.settlement_id,
        checker_id: 'usr_checker_rajesh',
        checker_name: 'Rajesh Kumar',
        notes: 'Verified against tenure logs and Form F declaration.',
        fnf_batch_id: 'FNF_BATCH_SEP26_01',
      });

      assert.equal(approval.success, true);
      assert.equal(approval.settlement_record.status, 'POSTED_TO_FNF');
      assert.equal(approval.settlement_record.checker_id, 'usr_checker_rajesh');
      assert.ok(approval.settlement_record.checker_timestamp);

      // Verify F&F Batch Integration
      const fnfEntry = approval.fnf_entry;
      assert.equal(fnfEntry.fnf_batch_id, 'FNF_BATCH_SEP26_01');
      assert.equal(fnfEntry.employee_id, 'EMP_VIKRAM_001');
      assert.equal(fnfEntry.disbursement_category, 'STATUTORY_GRATUITY');
      assert.equal(fnfEntry.payable_amount, calculatedSettlement.payable_gratuity_amount);
      assert.equal(fnfEntry.status, 'QUEUED_FOR_DISBURSEMENT');

      // Verify Corporate Liability Ledger Posting
      const ledgerEntry = approval.ledger_entry;
      assert.equal(ledgerEntry.debit_account, 'GL-2200 - Provision for Gratuity (Balance Sheet)');
      assert.equal(ledgerEntry.credit_account, 'GL-1100 - Bank / Payroll Clearing Account (F&F Disbursement)');
      assert.equal(ledgerEntry.amount, calculatedSettlement.payable_gratuity_amount);
      assert.equal(ledgerEntry.status, 'POSTED');
      assert.equal(ledgerEntry.approved_by, 'usr_checker_rajesh');
    });

    it('Should handle rejection workflow cleanly', async () => {
      const submitted = await service.submitForApproval({
        batch_id: 'GRAT_BATCH_SEP26',
        settlement: calculatedSettlement,
        employee_profile: sampleProfile,
        maker_id: 'usr_maker_1',
      });

      const rejected = await service.rejectGratuitySettlement({
        settlement_id: submitted.settlement_id,
        checker_id: 'usr_checker_2',
        reason: 'Basic salary component requires HR revision.',
      });

      assert.equal(rejected.status, 'REJECTED');
      assert.equal(rejected.checker_notes, 'Basic salary component requires HR revision.');
    });
  });
});
