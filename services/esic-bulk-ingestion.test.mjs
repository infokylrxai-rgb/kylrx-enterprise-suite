/**
 * ============================================================================
 * KYLRX AI ENTERPRISE HRMS - ESIC BULK INGESTION PROCESSOR TEST SUITE
 * ============================================================================
 * Automated Unit & Integration Tests for:
 *  1. CSV Ingestion & Header/Quote Parsing
 *  2. 10-Digit Statutory Format Validation (/^[0-9]{10}$/)
 *  3. Intra-Batch & Cross-Profile Duplication Guards
 *  4. Inverted Effective Dates & Tenure Date Gating
 *  5. Exception Pipeline & Staging Isolation
 *
 * @version 3.1.0
 * @author Kylrx AI Principal QA & Systems Architecture Team
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseEsicCsv,
  parseStrictBoolean,
  isValidIsoDate,
  processBulkEsicIngestion,
} from './esic-bulk-ingestion-processor.mjs';

describe('📦 KYLRX AI ESIC BULK INGESTION & VALIDATION PROCESSOR TEST SUITE', () => {

  describe('1. CSV Parsing & Helper Utilities', () => {
    it('Should parse valid CSV strings with standard columns', () => {
      const csv = [
        'employee_id,esic_number,esic_applicable,date_of_joining,date_of_exit,disability_flag,effective_from,effective_to',
        'EMP001,3100012345,true,2024-01-01,,false,2024-01-01,',
        'EMP002,3100098765,true,2023-05-15,,true,2023-05-15,',
      ].join('\r\n');

      const parsed = parseEsicCsv(csv);
      assert.strictEqual(parsed.length, 2);
      assert.strictEqual(parsed[0].row_number, 2);
      assert.strictEqual(parsed[0].raw_data.employee_id, 'EMP001');
      assert.strictEqual(parsed[0].raw_data.esic_number, '3100012345');
    });

    it('Should parse strict booleans across true/false/yes/no/1/0', () => {
      assert.strictEqual(parseStrictBoolean('true'), true);
      assert.strictEqual(parseStrictBoolean('True'), true);
      assert.strictEqual(parseStrictBoolean('YES'), true);
      assert.strictEqual(parseStrictBoolean('y'), true);
      assert.strictEqual(parseStrictBoolean('1'), true);
      assert.strictEqual(parseStrictBoolean(1), true);

      assert.strictEqual(parseStrictBoolean('false'), false);
      assert.strictEqual(parseStrictBoolean('NO'), false);
      assert.strictEqual(parseStrictBoolean('n'), false);
      assert.strictEqual(parseStrictBoolean('0'), false);
      assert.strictEqual(parseStrictBoolean(0), false);

      assert.strictEqual(parseStrictBoolean('invalid_string'), null);
      assert.strictEqual(parseStrictBoolean(''), null);
    });

    it('Should validate ISO Dates strictly', () => {
      assert.strictEqual(isValidIsoDate('2026-09-01'), true);
      assert.strictEqual(isValidIsoDate('2024-02-29'), true); // Leap year
      assert.strictEqual(isValidIsoDate('2023-02-29'), false); // Non-leap year
      assert.strictEqual(isValidIsoDate('2026-13-01'), false); // Month 13
      assert.strictEqual(isValidIsoDate('01-09-2026'), false); // Non ISO
      assert.strictEqual(isValidIsoDate('not-a-date'), false);
    });
  });

  describe('2. Clean Batch Ingestion & Database Staging', () => {
    it('Should stage 100% clean records with status SUCCESS and 0 exceptions', () => {
      const csv = [
        'employee_id,esic_number,esic_applicable,date_of_joining,date_of_exit,disability_flag,effective_from,effective_to',
        'EMP001,3100012345,true,2024-01-01,,false,2024-01-01,',
        'EMP002,3100012346,true,2023-06-01,,true,2023-06-01,2027-12-31',
        'EMP003,,false,2024-03-01,,false,2024-03-01,',
      ].join('\n');

      const result = processBulkEsicIngestion({ csvContent: csv });

      assert.strictEqual(result.status, 'SUCCESS');
      assert.strictEqual(result.total_rows, 3);
      assert.strictEqual(result.valid_rows_count, 3);
      assert.strictEqual(result.exception_rows_count, 0);
      assert.strictEqual(result.exceptions.length, 0);

      const rec1 = result.staged_records[0];
      assert.strictEqual(rec1.employee_id, 'EMP001');
      assert.strictEqual(rec1.esic_number, '3100012345');
      assert.strictEqual(rec1.esic_applicable, true);
      assert.strictEqual(rec1.disability_flag, false);
      assert.strictEqual(rec1.effective_to, null);

      const rec2 = result.staged_records[1];
      assert.strictEqual(rec2.disability_flag, true);
      assert.strictEqual(rec2.effective_to, '2027-12-31');

      const rec3 = result.staged_records[2];
      assert.strictEqual(rec3.esic_applicable, false);
      assert.strictEqual(rec3.esic_number, '');
    });
  });

  describe('3. Statutory 10-Digit Format & Malformed Number Interception', () => {
    it('Should intercept numbers that fail the 10-digit regex (/^[0-9]{10}$/)', () => {
      const csv = [
        'employee_id,esic_number,esic_applicable,date_of_joining,date_of_exit,disability_flag,effective_from,effective_to',
        'EMP_BAD_1,310001234,true,2024-01-01,,false,2024-01-01,', // 9 digits
        'EMP_BAD_2,31000123456,true,2024-01-01,,false,2024-01-01,', // 11 digits
        'EMP_BAD_3,31000A2345,true,2024-01-01,,false,2024-01-01,', // Alphanumeric
        'EMP_BAD_4,31000-1234,true,2024-01-01,,false,2024-01-01,', // Special characters
        'EMP_BAD_5,,true,2024-01-01,,false,2024-01-01,', // Empty when applicable: true
      ].join('\n');

      const result = processBulkEsicIngestion({ csvContent: csv });

      assert.strictEqual(result.status, 'FAILED');
      assert.strictEqual(result.valid_rows_count, 0);
      assert.strictEqual(result.exception_rows_count, 5);

      result.exceptions.forEach(exc => {
        assert.strictEqual(exc.code, 'ERR_MALFORMED_ESIC_NUMBER');
        assert.strictEqual(exc.field, 'esic_number');
      });
    });
  });

  describe('4. Duplication Guards (Intra-Batch & Existing Profiles DB)', () => {
    it('Should flag ERR_DUPLICATE_ESIC_NUMBER_BATCH when same 10-digit number appears multiple times in upload', () => {
      const csv = [
        'employee_id,esic_number,esic_applicable,date_of_joining,date_of_exit,disability_flag,effective_from,effective_to',
        'EMP_A,3100011111,true,2024-01-01,,false,2024-01-01,',
        'EMP_B,3100011111,true,2024-01-01,,false,2024-01-01,', // Duplicate of EMP_A
      ].join('\n');

      const result = processBulkEsicIngestion({ csvContent: csv });

      assert.strictEqual(result.status, 'PARTIAL_SUCCESS');
      assert.strictEqual(result.valid_rows_count, 1);
      assert.strictEqual(result.exception_rows_count, 1);

      const exc = result.exceptions.find(e => e.employee_id === 'EMP_B');
      assert.ok(exc);
      assert.strictEqual(exc.code, 'ERR_DUPLICATE_ESIC_NUMBER_BATCH');
      assert.ok(exc.message.includes('First seen on row 2'));
    });

    it('Should flag ERR_DUPLICATE_ESIC_NUMBER_EXISTING when number is already registered to another employee in DB', () => {
      const existingDbProfiles = [
        { employee_id: 'EMP_EXISTING_99', esic_number: '3100099999' }
      ];

      const csv = [
        'employee_id,esic_number,esic_applicable,date_of_joining,date_of_exit,disability_flag,effective_from,effective_to',
        'EMP_NEW_01,3100099999,true,2024-01-01,,false,2024-01-01,', // Collision with EMP_EXISTING_99
      ].join('\n');

      const result = processBulkEsicIngestion({
        csvContent: csv,
        existingProfiles: existingDbProfiles,
      });

      assert.strictEqual(result.status, 'FAILED');
      assert.strictEqual(result.valid_rows_count, 0);
      assert.strictEqual(result.exceptions.length, 1);
      assert.strictEqual(result.exceptions[0].code, 'ERR_DUPLICATE_ESIC_NUMBER_EXISTING');
      assert.ok(result.exceptions[0].message.includes('already registered to active employee "EMP_EXISTING_99"'));
    });
  });

  describe('5. Inverted Dates & Flag Validation', () => {
    it('Should flag ERR_INVERTED_EFFECTIVE_DATES when effective_from is after effective_to', () => {
      const csv = [
        'employee_id,esic_number,esic_applicable,date_of_joining,date_of_exit,disability_flag,effective_from,effective_to',
        'EMP001,3100012345,true,2024-01-01,,false,2025-01-01,2024-01-01', // Inverted
      ].join('\n');

      const result = processBulkEsicIngestion({ csvContent: csv });

      assert.strictEqual(result.status, 'FAILED');
      assert.strictEqual(result.exceptions.length, 1);
      assert.strictEqual(result.exceptions[0].code, 'ERR_INVERTED_EFFECTIVE_DATES');
    });

    it('Should flag ERR_INVERTED_EMPLOYMENT_DATES when date_of_joining is after date_of_exit', () => {
      const csv = [
        'employee_id,esic_number,esic_applicable,date_of_joining,date_of_exit,disability_flag,effective_from,effective_to',
        'EMP001,3100012345,true,2024-10-01,2024-05-01,false,2024-01-01,', // DOJ (Oct) > Exit (May)
      ].join('\n');

      const result = processBulkEsicIngestion({ csvContent: csv });

      assert.strictEqual(result.status, 'FAILED');
      assert.strictEqual(result.exceptions.length, 1);
      assert.strictEqual(result.exceptions[0].code, 'ERR_INVERTED_EMPLOYMENT_DATES');
    });

    it('Should flag ERR_INVALID_APPLICABLE_FLAG and ERR_INVALID_DISABILITY_FLAG on malformed boolean values', () => {
      const csv = [
        'employee_id,esic_number,esic_applicable,date_of_joining,date_of_exit,disability_flag,effective_from,effective_to',
        'EMP001,3100012345,MAYBE,2024-01-01,,PERHAPS,2024-01-01,',
      ].join('\n');

      const result = processBulkEsicIngestion({ csvContent: csv });

      assert.strictEqual(result.status, 'FAILED');
      assert.strictEqual(result.exceptions.length, 2);
      const codes = result.exceptions.map(e => e.code);
      assert.ok(codes.includes('ERR_INVALID_APPLICABLE_FLAG'));
      assert.ok(codes.includes('ERR_INVALID_DISABILITY_FLAG'));
    });
  });

  describe('6. Mixed Ingestion & Exception Reporting', () => {
    it('Should handle a mixed CSV staging clean records while logging granular row exceptions', () => {
      const csv = [
        'employee_id,esic_number,esic_applicable,date_of_joining,date_of_exit,disability_flag,effective_from,effective_to',
        'EMP_OK_1,3100012345,true,2024-01-01,,false,2024-01-01,', // OK
        'EMP_ERR_1,12345,true,2024-01-01,,false,2024-01-01,', // Malformed ESIC
        'EMP_OK_2,3100098765,true,2023-01-01,,true,2023-01-01,', // OK (Disabled)
        ',3100077777,true,2024-01-01,,false,2024-01-01,', // Missing EMP ID
      ].join('\n');

      const result = processBulkEsicIngestion({ csvContent: csv });

      assert.strictEqual(result.status, 'PARTIAL_SUCCESS');
      assert.strictEqual(result.total_rows, 4);
      assert.strictEqual(result.valid_rows_count, 2);
      assert.strictEqual(result.exception_rows_count, 2);
      assert.strictEqual(result.staged_records.length, 2);
      assert.strictEqual(result.exceptions.length, 2);
    });
  });

});
