/**
 * ============================================================================
 * TEST SUITE: MONTHLY ESIC RETURN & CHALLAN GENERATION SERVICE
 * ============================================================================
 * Tests:
 *  1. Template Mapping Engine: Validates column ordering, zero days reason codes, last working days
 *  2. Formatting & Excel Compatibility: CSV and Excel matrix compliance
 *  3. Integrity & SHA-256 Checksum: Cryptographic hash consistency & ComplianceReturn metadata
 *  4. Compliance Audit Trail: Immutable logging in compliance_audit_logs
 *  5. Error Handling & Custom Persistence Hooks
 */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {
  ESIC_PORTAL_LAYOUT_V1_0,
  mapRecordToPortalLayout,
  compileEsicPortalCsv,
  compileEsicExcelMatrix,
  generateMonthlyEsicReturnAndChallan,
  formatStatutoryDate,
  sanitizeCsvField,
  inMemoryComplianceReturns,
  inMemoryComplianceAuditLogs,
  resetComplianceStores,
} from './esic-return-challan-service.mjs';

describe('⚡ KYLRX AI MONTHLY ESIC RETURN & CHALLAN GENERATION SERVICE', () => {

  beforeEach(() => {
    resetComplianceStores();
  });

  describe('1. Template Mapping & Data Formatting', () => {
    it('Should correctly map employee records into statutory ESIC layout columns', () => {
      const record = {
        employee_id: 'EMP001',
        esic_number: '3123456789',
        employee_name: 'Aditi Sharma',
        payable_days: 26,
        gross_wages: 18500,
        employee_deduction: 139,
        employer_contribution: 601,
      };

      const mapped = mapRecordToPortalLayout(record);

      assert.equal(mapped.ip_number, '3123456789');
      assert.equal(mapped.ip_name, 'Aditi Sharma');
      assert.equal(mapped.days_worked, 26);
      assert.equal(mapped.total_monthly_wages, 18500);
      assert.equal(mapped.reason_code_zero_days, '');
      assert.equal(mapped.last_working_day, '');
      assert.equal(mapped.employee_share, 139);
      assert.equal(mapped.employer_share, 601);
    });

    it('Should populate reason code for zero working days and normalize last working day', () => {
      const record = {
        employee_id: 'EMP002',
        esic_number: '3198765432',
        employee_name: 'Rohan Gupta, Senior Analyst',
        days_worked: 0,
        gross_wages: 0,
        zero_days_reason_code: '2', // Left Service
        last_working_day: '2026-08-31',
      };

      const mapped = mapRecordToPortalLayout(record);

      assert.equal(mapped.days_worked, 0);
      assert.equal(mapped.reason_code_zero_days, '2');
      assert.equal(mapped.last_working_day, '31/08/2026');
    });

    it('Should format statutory dates into DD/MM/YYYY reliably', () => {
      assert.equal(formatStatutoryDate('2026-09-15'), '15/09/2026');
      assert.equal(formatStatutoryDate('15/09/2026'), '15/09/2026');
      assert.equal(formatStatutoryDate(''), '');
      assert.equal(formatStatutoryDate(null), '');
    });

    it('Should sanitize CSV fields containing commas or double quotes', () => {
      assert.equal(sanitizeCsvField('Sharma, Aditi'), '"Sharma, Aditi"');
      assert.equal(sanitizeCsvField('John "Jack" Doe'), '"John ""Jack"" Doe"');
      assert.equal(sanitizeCsvField('Normal Name'), 'Normal Name');
    });
  });

  describe('2. Layout Compilation (CSV & Excel Matrix)', () => {
    it('Should compile CSV with exact statutory headers and CRLF line endings', () => {
      const mappedRows = [
        {
          ip_number: '3123456789',
          ip_name: 'Aditi Sharma',
          days_worked: 30,
          total_monthly_wages: 20000,
          reason_code_zero_days: '',
          last_working_day: '',
        },
        {
          ip_number: '3198765432',
          ip_name: 'Rajesh "Ace" Kumar',
          days_worked: 0,
          total_monthly_wages: 0,
          reason_code_zero_days: '1',
          last_working_day: '15/09/2026',
        }
      ];

      const csv = compileEsicPortalCsv(mappedRows, ESIC_PORTAL_LAYOUT_V1_0);
      const lines = csv.split('\r\n');

      assert.equal(lines.length, 3);
      assert.equal(
        lines[0],
        'IP Number,IP Name,No of Days for which wages paid,Total Monthly Wages,Reason Code for Zero Working Days,Last Working Day'
      );
      assert.equal(lines[1], '3123456789,"Aditi Sharma",30,20000.00,,');
      assert.equal(lines[2], '3198765432,"Rajesh ""Ace"" Kumar",0,0.00,1,15/09/2026');
    });

    it('Should produce Excel-compatible matrix representation', () => {
      const mappedRows = [
        {
          ip_number: '3123456789',
          ip_name: 'Aditi Sharma',
          days_worked: 30,
          total_monthly_wages: 20000,
          reason_code_zero_days: '',
          last_working_day: '',
        }
      ];

      const matrix = compileEsicExcelMatrix(mappedRows);
      assert.equal(matrix.length, 2);
      assert.deepEqual(matrix[0], [
        'IP Number',
        'IP Name',
        'No of Days for which wages paid',
        'Total Monthly Wages',
        'Reason Code for Zero Working Days',
        'Last Working Day'
      ]);
      assert.deepEqual(matrix[1], [
        '3123456789',
        'Aditi Sharma',
        30,
        20000.00,
        '',
        ''
      ]);
    });
  });

  describe('3. Integrity Checksum & ComplianceReturn Metadata Generation', () => {
    it('Should compute authentic SHA-256 checksum and build ComplianceReturn entity', async () => {
      const records = [
        {
          employee_id: 'EMP_101',
          esic_number: '3100001111',
          employee_name: 'Pooja Verma',
          days_worked: 30,
          gross_wages: 20000,
          employee_deduction: 150, // 0.75%
          employer_contribution: 650, // 3.25%
        },
        {
          employee_id: 'EMP_102',
          esic_number: '3100002222',
          employee_name: 'Vikram Seth',
          days_worked: 25,
          gross_wages: 16000,
          employee_deduction: 120,
          employer_contribution: 520,
        }
      ];

      const result = await generateMonthlyEsicReturnAndChallan({
        employer_code: '31000123450000999',
        period: 'September 2026',
        source_payroll_run_id: 'run_202609_finalized',
        validated_calculations: records,
        admin_id: 'admin_sys_42',
        policy_version_applied: 'ESIC_POL_2019_V1',
      });

      assert.equal(result.success, true);
      assert.ok(result.return_id.startsWith('esic_ret_'));

      // Checksum validation
      const expectedHash = crypto.createHash('sha256').update(result.file.content, 'utf8').digest('hex');
      assert.equal(result.file.checksum_sha256, expectedHash);
      assert.equal(result.compliance_return.checksum, expectedHash);

      // ComplianceReturn properties
      const ret = result.compliance_return;
      assert.equal(ret.scheme, 'ESIC');
      assert.equal(ret.period, 'September 2026');
      assert.equal(ret.source_payroll_run_id, 'run_202609_finalized');
      assert.equal(ret.policy_version_applied, 'ESIC_POL_2019_V1');
      assert.equal(ret.row_count, 2);
      assert.equal(ret.total_employee_share, 270);
      assert.equal(ret.total_employer_share, 1170);
      assert.equal(ret.total_challan_amount, 1440);
      assert.equal(ret.status, 'GENERATED');
      assert.equal(ret.created_by, 'admin_sys_42');

      // Persistence check in inMemoryComplianceReturns
      assert.ok(inMemoryComplianceReturns.has(result.return_id));
      assert.deepEqual(inMemoryComplianceReturns.get(result.return_id), ret);
    });

    it('Should reject generation when source_payroll_run_id is missing', async () => {
      await assert.rejects(
        async () => {
          await generateMonthlyEsicReturnAndChallan({
            employer_code: '31000123450000999',
            period: 'September 2026',
            validated_calculations: [],
          });
        },
        { message: /source_payroll_run_id is required/ }
      );
    });
  });

  describe('4. Immutable Audit Trail Logging', () => {
    it('Should write comprehensive audit log to compliance_audit_logs store', async () => {
      const records = [
        {
          employee_id: 'EMP_301',
          esic_number: '3155554444',
          employee_name: 'Ananya Roy',
          days_worked: 30,
          gross_wages: 21000,
          employee_deduction: 158,
          employer_contribution: 683,
        }
      ];

      const result = await generateMonthlyEsicReturnAndChallan({
        employer_code: '31000999990000111',
        period: 'September 2026',
        source_payroll_run_id: 'run_sep26_audit_test',
        validated_calculations: records,
        admin_id: 'compliance_officer_priya',
        policy_version_applied: 'ESIC_POL_2019_V1',
      });

      assert.equal(inMemoryComplianceAuditLogs.length, 1);
      const auditLog = inMemoryComplianceAuditLogs[0];

      assert.equal(auditLog.admin_id, 'compliance_officer_priya');
      assert.equal(auditLog.action, 'ESIC_RETURN_GENERATED');
      assert.equal(auditLog.scheme, 'ESIC');
      assert.equal(auditLog.period, 'September 2026');
      assert.equal(auditLog.source_payroll_run_id, 'run_sep26_audit_test');
      assert.equal(auditLog.submission_status, 'GENERATED');

      // Input parameters captured
      assert.deepEqual(auditLog.input_calculation_parameters, {
        employer_code: '31000999990000111',
        wage_month: 'September 2026',
        policy_version_applied: 'ESIC_POL_2019_V1',
        total_candidates: 1,
        total_eligible_wages: 21000,
      });

      // Raw output metadata
      assert.equal(auditLog.raw_output_file_metadata.row_count, 1);
      assert.equal(auditLog.raw_output_file_metadata.total_employee_share, 158);
      assert.equal(auditLog.raw_output_file_metadata.total_employer_share, 683);
      assert.equal(auditLog.raw_output_file_metadata.total_challan_amount, 841);
      assert.equal(auditLog.raw_output_file_metadata.checksum, result.file.checksum_sha256);
      assert.ok(auditLog.timestamp);
    });

    it('Should support custom persistence callbacks for database integration', async () => {
      const persistedReturns = [];
      const persistedAuditLogs = [];

      await generateMonthlyEsicReturnAndChallan({
        employer_code: '31000123450000999',
        period: 'September 2026',
        source_payroll_run_id: 'run_custom_hooks',
        validated_calculations: [
          {
            esic_number: '3100008888',
            employee_name: 'Karan Mehra',
            days_worked: 30,
            gross_wages: 15000,
            employee_deduction: 113,
            employer_contribution: 488,
          }
        ],
        admin_id: 'admin_custom',
        options: {
          saveComplianceReturn: async (ret) => { persistedReturns.push(ret); },
          saveAuditLog: async (log) => { persistedAuditLogs.push(log); },
        }
      });

      assert.equal(persistedReturns.length, 1);
      assert.equal(persistedAuditLogs.length, 1);
      assert.equal(persistedReturns[0].source_payroll_run_id, 'run_custom_hooks');
      assert.equal(persistedAuditLogs[0].admin_id, 'admin_custom');
    });
  });
});
