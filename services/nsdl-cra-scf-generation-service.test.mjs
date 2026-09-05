/**
 * ============================================================================
 * KYLRX AI ENTERPRISE HRMS - NSDL / CRA SCF GENERATION SERVICE TEST SUITE
 * ============================================================================
 * Tests for:
 *  1. FH, BH, SD, and FT structural record mappings with Caret ^ delimiters
 *  2. SHA-256 checksum calculation & integrity verification
 *  3. ComplianceReturn (scheme: 'NPS') persistence and audit trail logging
 *  4. Downloadable file asset metadata and SCF content parser
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {
  generateNsdlCraScfFile,
  parseNsdlCraScfFile,
  formatNpsMonthYear,
  sanitizeNsdlField,
  getNpsComplianceReturns,
  getNpsComplianceReturnById,
  resetNpsComplianceStores,
  inMemoryNpsComplianceReturns,
  inMemoryNpsAuditLogs,
} from './nsdl-cra-scf-generation-service.mjs';

test('⚡ KYLRX AI NSDL / CRA SCF GENERATION & COMPLIANCE RETURN TEST SUITE', async (t) => {

  t.beforeEach(() => {
    resetNpsComplianceStores();
  });

  await t.test('1. Helper Utilities: Month-Year Normalization & Field Sanitization', async (t2) => {
    await t2.test('Should normalize varied date formats to MMYYYY statutory string', () => {
      assert.strictEqual(formatNpsMonthYear('2026-09'), '092026');
      assert.strictEqual(formatNpsMonthYear('2026-09-15'), '092026');
      assert.strictEqual(formatNpsMonthYear('September 2026'), '092026');
      assert.strictEqual(formatNpsMonthYear('08/2026'), '082026');
      assert.strictEqual(formatNpsMonthYear('15/08/2026'), '082026');
      assert.strictEqual(formatNpsMonthYear('092026'), '092026');
    });

    await t2.test('Should sanitize fields by stripping caret and newline characters', () => {
      assert.strictEqual(sanitizeNsdlField('Aarav^Mehta'), 'Aarav Mehta');
      assert.strictEqual(sanitizeNsdlField('Line1\r\nLine2'), 'Line1  Line2');
      assert.strictEqual(sanitizeNsdlField(null), '');
      assert.strictEqual(sanitizeNsdlField(undefined), '');
    });
  });

  await t.test('2. Structural Record Mapping (FH, BH, SD, FT) with Caret ^ Delimiters', async (t2) => {
    await t2.test('Should compile valid NSDL CRA SCF with exact structural records', () => {
      const records = [
        {
          employee_id: 'EMP_101',
          employee_name: 'Devansh Verma',
          pran: '110000112233',
          contribution_type: 'BOTH',
          employer_contribution: 6000.00,
          employee_mandatory_deduction: 6000.00,
          employee_voluntary_contribution: 1500.00,
          total_employee_contribution: 7500.00,
          total_nps_contribution: 13500.00,
        },
        {
          employee_id: 'EMP_102',
          employee_name: 'Pooja Iyer',
          pran: '110044556677',
          contribution_type: 'EMPLOYER_ONLY',
          employer_contribution: 8000.00,
          employee_mandatory_deduction: 0.00,
          employee_voluntary_contribution: 0.00,
          total_employee_contribution: 0.00,
          total_nps_contribution: 8000.00,
        },
      ];

      const result = generateNsdlCraScfFile({
        corporateRegistrationNumber: 'CHO98765',
        paoOrPopSpCode: 'POP00123',
        entityName: 'Kylrx Corp India Ltd',
        period: 'September 2026',
        sourceRunId: 'PAYROLL_RUN_2026_09',
        adminUser: 'lead_architect@kylrx.ai',
        records,
        options: {
          creationDateStr: '20260904',
          creationTimeStr: '120000',
          fileRefNo: 'SCF999001',
          batchSerial: '001',
        },
      });

      const lines = result.content.split('\r\n');
      assert.strictEqual(lines.length, 5); // FH + BH + 2 SDs + FT

      // 1. Check File Header (FH)
      // FH^01^SCF^CHO98765^SCF999001^20260904^120000^Kylrx Corp India Ltd
      const fhParts = lines[0].split('^');
      assert.strictEqual(fhParts[0], 'FH');
      assert.strictEqual(fhParts[1], '01');
      assert.strictEqual(fhParts[2], 'SCF');
      assert.strictEqual(fhParts[3], 'CHO98765');
      assert.strictEqual(fhParts[4], 'SCF999001');
      assert.strictEqual(fhParts[5], '20260904');
      assert.strictEqual(fhParts[6], '120000');
      assert.strictEqual(fhParts[7], 'Kylrx Corp India Ltd');

      // 2. Check Batch Header (BH)
      // BH^02^001^POP00123^2^21500.00^092026
      const bhParts = lines[1].split('^');
      assert.strictEqual(bhParts[0], 'BH');
      assert.strictEqual(bhParts[1], '02');
      assert.strictEqual(bhParts[2], '001');
      assert.strictEqual(bhParts[3], 'POP00123');
      assert.strictEqual(bhParts[4], '2'); // 2 subscribers
      assert.strictEqual(bhParts[5], '21500.00'); // 13500 + 8000
      assert.strictEqual(bhParts[6], '092026');

      // 3. Check Subscriber Details (SD)
      // SD^1^110000112233^Devansh Verma^7500.00^6000.00^13500.00^BOTH^092026
      const sd1Parts = lines[2].split('^');
      assert.strictEqual(sd1Parts[0], 'SD');
      assert.strictEqual(sd1Parts[1], '1');
      assert.strictEqual(sd1Parts[2], '110000112233');
      assert.strictEqual(sd1Parts[3], 'Devansh Verma');
      assert.strictEqual(sd1Parts[4], '7500.00');
      assert.strictEqual(sd1Parts[5], '6000.00');
      assert.strictEqual(sd1Parts[6], '13500.00');
      assert.strictEqual(sd1Parts[7], 'BOTH');
      assert.strictEqual(sd1Parts[8], '092026');

      // SD^2^110044556677^Pooja Iyer^0.00^8000.00^8000.00^EMPLOYER_ONLY^092026
      const sd2Parts = lines[3].split('^');
      assert.strictEqual(sd2Parts[0], 'SD');
      assert.strictEqual(sd2Parts[1], '2');
      assert.strictEqual(sd2Parts[2], '110044556677');
      assert.strictEqual(sd2Parts[3], 'Pooja Iyer');
      assert.strictEqual(sd2Parts[4], '0.00');
      assert.strictEqual(sd2Parts[5], '8000.00');
      assert.strictEqual(sd2Parts[6], '8000.00');
      assert.strictEqual(sd2Parts[7], 'EMPLOYER_ONLY');
      assert.strictEqual(sd2Parts[8], '092026');

      // 4. Check File Trailer (FT)
      // FT^03^1^2^5^21500.00
      const ftParts = lines[4].split('^');
      assert.strictEqual(ftParts[0], 'FT');
      assert.strictEqual(ftParts[1], '03');
      assert.strictEqual(ftParts[2], '1'); // Total batches
      assert.strictEqual(ftParts[3], '2'); // Total subscribers
      assert.strictEqual(ftParts[4], '5'); // Total lines (FH, BH, 2 SDs, FT)
      assert.strictEqual(ftParts[5], '21500.00'); // Grand total amount
    });
  });

  await t.test('3. SHA-256 Checksum Calculation & Integrity', async (t2) => {
    await t2.test('Should compute matching SHA-256 hash across generated .txt file', () => {
      const records = [
        {
          employee_id: 'EMP_HASH_1',
          employee_name: 'Anil Ambani',
          pran: '110088889999',
          contribution_type: 'BOTH',
          employer_contribution: 5000,
          total_employee_contribution: 5000,
          total_nps_contribution: 10000,
        },
      ];

      const result = generateNsdlCraScfFile({
        corporateRegistrationNumber: 'CHO11111',
        records,
        period: 'September 2026',
      });

      const expectedSha256 = crypto
        .createHash('sha256')
        .update(Buffer.from(result.content, 'utf8'))
        .digest('hex');

      assert.strictEqual(result.checksum_sha256, expectedSha256);
      assert.strictEqual(result.compliance_return.checksum_sha256, expectedSha256);
      assert.strictEqual(result.audit_log.checksum_sha256, expectedSha256);
    });
  });

  await t.test('4. ComplianceReturn Persistence & Audit Trail', async (t2) => {
    await t2.test('Should persist ComplianceReturn with scheme NPS and record audit log', () => {
      const records = [
        {
          employee_id: 'EMP_AUDIT_1',
          employee_name: 'Tanvi Shah',
          pran: '110055554444',
          contribution_type: 'BOTH',
          employer_contribution: 4000,
          total_employee_contribution: 4000,
          total_nps_contribution: 8000,
        },
      ];

      const result = generateNsdlCraScfFile({
        corporateRegistrationNumber: 'CHO77777',
        paoOrPopSpCode: 'POP00555',
        period: 'September 2026',
        sourceRunId: 'RUN_NPS_SETTLEMENT_01',
        adminUser: 'compliance_officer@kylrx.ai',
        records,
      });

      // Verify ComplianceReturn entity
      const ret = result.compliance_return;
      assert.ok(ret.return_id.startsWith('RET_NPS_'));
      assert.strictEqual(ret.scheme, 'NPS');
      assert.strictEqual(ret.period, 'September 2026');
      assert.strictEqual(ret.month_year, '092026');
      assert.strictEqual(ret.file_name, 'NSDL_CRA_SCF_CHO77777_092026.txt');
      assert.strictEqual(ret.row_count, 1);
      assert.strictEqual(ret.total_subscribers, 1);
      assert.strictEqual(ret.total_amount, 8000);
      assert.strictEqual(ret.total_employer_share, 4000);
      assert.strictEqual(ret.total_employee_share, 4000);
      assert.strictEqual(ret.source_payroll_run_id, 'RUN_NPS_SETTLEMENT_01');
      assert.strictEqual(ret.status, 'GENERATED');
      assert.strictEqual(ret.executing_admin, 'compliance_officer@kylrx.ai');

      // Verify in-memory storage lookup
      assert.strictEqual(inMemoryNpsComplianceReturns.size, 1);
      const fetched = getNpsComplianceReturnById(ret.return_id);
      assert.deepStrictEqual(fetched, ret);

      // Verify filtered query
      const filtered = getNpsComplianceReturns({ month_year: '092026' });
      assert.strictEqual(filtered.length, 1);

      // Verify Audit Log
      assert.strictEqual(inMemoryNpsAuditLogs.length, 1);
      assert.strictEqual(inMemoryNpsAuditLogs[0].event, 'NSDL_CRA_SCF_GENERATED');
      assert.strictEqual(inMemoryNpsAuditLogs[0].scheme, 'NPS');
      assert.strictEqual(inMemoryNpsAuditLogs[0].executed_by, 'compliance_officer@kylrx.ai');
    });
  });

  await t.test('5. Downloadable File Asset & Parser Verification', async (t2) => {
    await t2.test('Should parse compiled SCF file and confirm structural integrity', () => {
      const records = [
        {
          employee_id: 'EMP_301',
          employee_name: 'Meera Nambiar',
          pran: '110099990000',
          contribution_type: 'BOTH',
          employer_contribution: 10000,
          total_employee_contribution: 10000,
          total_nps_contribution: 20000,
        },
      ];

      const fileResult = generateNsdlCraScfFile({
        corporateRegistrationNumber: 'CHO88888',
        records,
        period: 'September 2026',
      });

      assert.strictEqual(fileResult.file_type, 'NSDL_CRA_SCF_TXT');
      assert.strictEqual(fileResult.mime_type, 'text/plain');
      assert.ok(fileResult.file_size_bytes > 0);

      // Parse generated file
      const parsed = parseNsdlCraScfFile(fileResult.content);
      assert.strictEqual(parsed.is_valid_structure, true);
      assert.strictEqual(parsed.file_header.corporate_registration_number, 'CHO88888');
      assert.strictEqual(parsed.batch_header.total_subscribers, 1);
      assert.strictEqual(parsed.batch_header.total_amount, 20000);
      assert.strictEqual(parsed.subscriber_records.length, 1);
      assert.strictEqual(parsed.subscriber_records[0].pran, '110099990000');
      assert.strictEqual(parsed.file_trailer.grand_total_amount, 20000);
    });
  });

});
