/**
 * ============================================================================
 * KYLRX AI ENTERPRISE HRMS - ESIC BULK INGESTION & VALIDATION PROCESSOR
 * ============================================================================
 * High-Throughput CSV Parser, Format & Duplication Guardrails, and Exception
 * Staging Pipeline for Employee ESIC Master Data.
 *
 * @version 3.1.0
 * @author Kylrx AI Lead Systems Architect
 */

import crypto from 'node:crypto';

export const ESIC_10_DIGIT_REGEX = /^[0-9]{10}$/;

/**
 * Standard CSV Template Column Headers for ESIC Master Data Upload.
 */
export const ESIC_CSV_COLUMNS = Object.freeze([
  'employee_id',
  'esic_number',
  'esic_applicable',
  'date_of_joining',
  'date_of_exit',
  'disability_flag',
  'effective_from',
  'effective_to',
]);

/**
 * Parses raw CSV content into structured objects.
 * Handles quoted strings, commas, line endings (\r\n, \n), and BOM.
 *
 * @param {string} csvContent
 * @returns {Array<object>} Parsed rows with line numbers
 */
export function parseEsicCsv(csvContent) {
  if (!csvContent || typeof csvContent !== 'string') {
    throw new Error('CSV content must be a non-empty string.');
  }

  // Strip UTF-8 Byte Order Mark (BOM) if present
  const cleanContent = csvContent.replace(/^\uFEFF/, '').trim();
  if (!cleanContent) {
    return [];
  }

  const lines = cleanContent.split(/\r\n|\n|\r/).map(line => line.trim()).filter(line => line.length > 0);
  if (lines.length === 0) return [];

  // Parse header
  const headerLine = lines[0];
  const headers = parseCsvLine(headerLine).map(h => h.toLowerCase().trim().replace(/[\s-]+/g, '_'));

  const parsedRows = [];

  for (let i = 1; i < lines.length; i++) {
    const rawLine = lines[i];
    if (!rawLine) continue;

    const values = parseCsvLine(rawLine);
    const rowObj = {};

    headers.forEach((header, idx) => {
      rowObj[header] = values[idx] !== undefined ? values[idx].trim() : '';
    });

    parsedRows.push({
      row_number: i + 1, // 1-based index (Header is row 1)
      raw_data: rowObj,
      raw_line: rawLine,
    });
  }

  return parsedRows;
}

/**
 * Parses a single CSV line honoring quotes and escaped commas.
 *
 * @param {string} line
 * @returns {string[]}
 */
function parseCsvLine(line) {
  const result = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];

    if (char === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i++; // Skip escaped quote
      } else {
        inQuotes = !inQuotes;
      }
    } else if (char === ',' && !inQuotes) {
      result.push(current);
      current = '';
    } else {
      current += char;
    }
  }
  result.push(current);
  return result;
}

/**
 * Helper to parse boolean values strictly.
 *
 * @param {any} val
 * @returns {boolean|null} Returns true/false or null if invalid
 */
export function parseStrictBoolean(val) {
  if (typeof val === 'boolean') return val;
  if (typeof val === 'number') {
    if (val === 1) return true;
    if (val === 0) return false;
    return null;
  }
  if (!val && val !== '') return null;

  const s = String(val).trim().toLowerCase();
  if (['true', '1', 'yes', 'y'].includes(s)) return true;
  if (['false', '0', 'no', 'n'].includes(s)) return false;
  return null;
}

/**
 * Validates ISO Date format YYYY-MM-DD and ensures valid calendar day (e.g. leap year checks).
 *
 * @param {string} dateStr
 * @returns {boolean}
 */
export function isValidIsoDate(dateStr) {
  if (!dateStr || typeof dateStr !== 'string') return false;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return false;

  const [year, month, day] = dateStr.split('-').map(Number);
  if (month < 1 || month > 12) return false;
  if (day < 1 || day > 31) return false;

  const d = new Date(Date.UTC(year, month - 1, day));
  if (isNaN(d.getTime())) return false;

  // Strict calendar validity check (prevents Feb 29 rollover on non-leap years)
  return (
    d.getUTCFullYear() === year &&
    d.getUTCMonth() + 1 === month &&
    d.getUTCDate() === day
  );
}

/**
 * Validates a single ESIC upload row against canonical statutory rules.
 *
 * @param {object} rowItem
 * @param {string} batchId
 * @param {Map<string, number>} intraBatchEsicMap Track seen ESIC numbers in current batch
 * @param {Map<string, string>} existingActiveProfilesMap Track existing ESIC numbers in DB (esic_number -> employee_id)
 * @returns {{ isValid: boolean, stagedRecord: object|null, exceptions: Array<object> }}
 */
export function validateEsicRow(rowItem, batchId, intraBatchEsicMap, existingActiveProfilesMap = new Map()) {
  const { row_number, raw_data } = rowItem;
  const exceptions = [];

  const employeeId = String(raw_data.employee_id || raw_data.employeeid || '').trim();
  const rawEsicNumber = String(raw_data.esic_number || raw_data.esicnumber || raw_data.ip_number || '').trim();
  const rawApplicable = raw_data.esic_applicable ?? raw_data.applicable;
  const doj = String(raw_data.date_of_joining || raw_data.doj || '').trim();
  const doe = String(raw_data.date_of_exit || raw_data.doe || '').trim();
  const rawDisability = raw_data.disability_flag ?? raw_data.disability;
  const effectiveFrom = String(raw_data.effective_from || raw_data.effectivefrom || '').trim();
  const effectiveTo = String(raw_data.effective_to || raw_data.effectiveto || '').trim();

  // 1. Mandatory Employee ID Check
  if (!employeeId) {
    exceptions.push({
      exception_id: `EXC-${batchId}-${row_number}-EMP_ID`,
      batch_id: batchId,
      row_number,
      employee_id: 'UNKNOWN',
      field: 'employee_id',
      code: 'ERR_MISSING_EMPLOYEE_ID',
      message: 'Employee ID is required and cannot be empty.',
      raw_data,
      created_at: new Date().toISOString(),
    });
  }

  // 2. Boolean Applicable Flag Validation
  const esicApplicable = parseStrictBoolean(rawApplicable);
  if (esicApplicable === null) {
    exceptions.push({
      exception_id: `EXC-${batchId}-${row_number}-APPLICABLE`,
      batch_id: batchId,
      row_number,
      employee_id: employeeId || 'UNKNOWN',
      field: 'esic_applicable',
      code: 'ERR_INVALID_APPLICABLE_FLAG',
      message: `Invalid esic_applicable value "${rawApplicable}". Expected boolean (true/false, yes/no, 1/0).`,
      raw_data,
      created_at: new Date().toISOString(),
    });
  }

  // 3. Boolean Disability Flag Validation
  const disabilityFlag = parseStrictBoolean(rawDisability);
  if (disabilityFlag === null) {
    exceptions.push({
      exception_id: `EXC-${batchId}-${row_number}-DISABILITY`,
      batch_id: batchId,
      row_number,
      employee_id: employeeId || 'UNKNOWN',
      field: 'disability_flag',
      code: 'ERR_INVALID_DISABILITY_FLAG',
      message: `Invalid disability_flag value "${rawDisability}". Expected boolean (true/false, yes/no, 1/0).`,
      raw_data,
      created_at: new Date().toISOString(),
    });
  }

  // 4. Format & Statutory 10-Digit Guard (/^[0-9]{10}$/)
  if (esicApplicable === true || (rawEsicNumber && esicApplicable !== false)) {
    if (!rawEsicNumber) {
      exceptions.push({
        exception_id: `EXC-${batchId}-${row_number}-ESIC_NUM_EMPTY`,
        batch_id: batchId,
        row_number,
        employee_id: employeeId || 'UNKNOWN',
        field: 'esic_number',
        code: 'ERR_MALFORMED_ESIC_NUMBER',
        message: 'ESIC number is mandatory when esic_applicable is true.',
        raw_data,
        created_at: new Date().toISOString(),
      });
    } else if (!ESIC_10_DIGIT_REGEX.test(rawEsicNumber)) {
      exceptions.push({
        exception_id: `EXC-${batchId}-${row_number}-ESIC_NUM_FMT`,
        batch_id: batchId,
        row_number,
        employee_id: employeeId || 'UNKNOWN',
        field: 'esic_number',
        code: 'ERR_MALFORMED_ESIC_NUMBER',
        message: `ESIC number "${rawEsicNumber}" does not match the 10-digit statutory numeric format (/^[0-9]{10}$/). Length must be exactly 10 digits.`,
        raw_data,
        created_at: new Date().toISOString(),
      });
    } else {
      // 5. Duplication Guards (Intra-batch & Cross-Profile DB)
      if (intraBatchEsicMap.has(rawEsicNumber)) {
        const firstSeenRow = intraBatchEsicMap.get(rawEsicNumber);
        exceptions.push({
          exception_id: `EXC-${batchId}-${row_number}-DUP_BATCH`,
          batch_id: batchId,
          row_number,
          employee_id: employeeId || 'UNKNOWN',
          field: 'esic_number',
          code: 'ERR_DUPLICATE_ESIC_NUMBER_BATCH',
          message: `Duplicate ESIC number "${rawEsicNumber}" detected within upload batch (First seen on row ${firstSeenRow}).`,
          raw_data,
          created_at: new Date().toISOString(),
        });
      } else {
        intraBatchEsicMap.set(rawEsicNumber, row_number);
      }

      if (existingActiveProfilesMap.has(rawEsicNumber)) {
        const existingEmpId = existingActiveProfilesMap.get(rawEsicNumber);
        if (existingEmpId !== employeeId) {
          exceptions.push({
            exception_id: `EXC-${batchId}-${row_number}-DUP_DB`,
            batch_id: batchId,
            row_number,
            employee_id: employeeId || 'UNKNOWN',
            field: 'esic_number',
            code: 'ERR_DUPLICATE_ESIC_NUMBER_EXISTING',
            message: `ESIC number "${rawEsicNumber}" is already registered to active employee "${existingEmpId}" in master database.`,
            raw_data,
            created_at: new Date().toISOString(),
          });
        }
      }
    }
  }

  // 6. Effective Dates Chronology & Format
  if (!effectiveFrom) {
    exceptions.push({
      exception_id: `EXC-${batchId}-${row_number}-EFF_FROM_REQ`,
      batch_id: batchId,
      row_number,
      employee_id: employeeId || 'UNKNOWN',
      field: 'effective_from',
      code: 'ERR_INVALID_DATE_FORMAT',
      message: 'effective_from is required and must follow YYYY-MM-DD.',
      raw_data,
      created_at: new Date().toISOString(),
    });
  } else if (!isValidIsoDate(effectiveFrom)) {
    exceptions.push({
      exception_id: `EXC-${batchId}-${row_number}-EFF_FROM_FMT`,
      batch_id: batchId,
      row_number,
      employee_id: employeeId || 'UNKNOWN',
      field: 'effective_from',
      code: 'ERR_INVALID_DATE_FORMAT',
      message: `Invalid effective_from date "${effectiveFrom}". Expected YYYY-MM-DD.`,
      raw_data,
      created_at: new Date().toISOString(),
    });
  }

  if (effectiveTo) {
    if (!isValidIsoDate(effectiveTo)) {
      exceptions.push({
        exception_id: `EXC-${batchId}-${row_number}-EFF_TO_FMT`,
        batch_id: batchId,
        row_number,
        employee_id: employeeId || 'UNKNOWN',
        field: 'effective_to',
        code: 'ERR_INVALID_DATE_FORMAT',
        message: `Invalid effective_to date "${effectiveTo}". Expected YYYY-MM-DD.`,
        raw_data,
        created_at: new Date().toISOString(),
      });
    } else if (isValidIsoDate(effectiveFrom) && effectiveFrom > effectiveTo) {
      exceptions.push({
        exception_id: `EXC-${batchId}-${row_number}-INVERTED_EFF`,
        batch_id: batchId,
        row_number,
        employee_id: employeeId || 'UNKNOWN',
        field: 'effective_to',
        code: 'ERR_INVERTED_EFFECTIVE_DATES',
        message: `Inverted effective date range: effective_from (${effectiveFrom}) cannot be after effective_to (${effectiveTo}).`,
        raw_data,
        created_at: new Date().toISOString(),
      });
    }
  }

  // 7. Employment Dates (DOJ & Exit Date)
  if (!doj) {
    exceptions.push({
      exception_id: `EXC-${batchId}-${row_number}-DOJ_REQ`,
      batch_id: batchId,
      row_number,
      employee_id: employeeId || 'UNKNOWN',
      field: 'date_of_joining',
      code: 'ERR_INVALID_DATE_FORMAT',
      message: 'date_of_joining is required and must follow YYYY-MM-DD.',
      raw_data,
      created_at: new Date().toISOString(),
    });
  } else if (!isValidIsoDate(doj)) {
    exceptions.push({
      exception_id: `EXC-${batchId}-${row_number}-DOJ_FMT`,
      batch_id: batchId,
      row_number,
      employee_id: employeeId || 'UNKNOWN',
      field: 'date_of_joining',
      code: 'ERR_INVALID_DATE_FORMAT',
      message: `Invalid date_of_joining "${doj}". Expected YYYY-MM-DD.`,
      raw_data,
      created_at: new Date().toISOString(),
    });
  }

  if (doe) {
    if (!isValidIsoDate(doe)) {
      exceptions.push({
        exception_id: `EXC-${batchId}-${row_number}-DOE_FMT`,
        batch_id: batchId,
        row_number,
        employee_id: employeeId || 'UNKNOWN',
        field: 'date_of_exit',
        code: 'ERR_INVALID_DATE_FORMAT',
        message: `Invalid date_of_exit "${doe}". Expected YYYY-MM-DD.`,
        raw_data,
        created_at: new Date().toISOString(),
      });
    } else if (isValidIsoDate(doj) && doj > doe) {
      exceptions.push({
        exception_id: `EXC-${batchId}-${row_number}-INVERTED_EMP`,
        batch_id: batchId,
        row_number,
        employee_id: employeeId || 'UNKNOWN',
        field: 'date_of_exit',
        code: 'ERR_INVERTED_EMPLOYMENT_DATES',
        message: `Inverted employment dates: date_of_joining (${doj}) cannot be after date_of_exit (${doe}).`,
        raw_data,
        created_at: new Date().toISOString(),
      });
    }
  }

  if (exceptions.length > 0) {
    return {
      isValid: false,
      stagedRecord: null,
      exceptions,
    };
  }

  // Clean staging record
  const stagedRecord = {
    employee_id: employeeId,
    esic_number: esicApplicable ? rawEsicNumber : '',
    esic_applicable: Boolean(esicApplicable),
    date_of_joining: doj,
    date_of_exit: doe || null,
    disability_flag: Boolean(disabilityFlag),
    effective_from: effectiveFrom,
    effective_to: effectiveTo || null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };

  return {
    isValid: true,
    stagedRecord,
    exceptions: [],
  };
}

/**
 * Bulk Ingestion & Validation Pipeline for Employee ESIC Master Data.
 *
 * @param {object} params
 * @param {string} params.csvContent CSV payload
 * @param {Array<object>} [params.existingProfiles=[]] Existing database profiles to check duplication against
 * @param {string} [params.batchId] Optional custom batch ID
 * @returns {object} ESICBulkIngestionResult
 */
export function processBulkEsicIngestion({
  csvContent,
  existingProfiles = [],
  batchId = null,
}) {
  const currentBatchId = batchId || `ESIC-INGEST-${Date.now()}-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;
  const parsedRows = parseEsicCsv(csvContent);

  const intraBatchEsicMap = new Map();
  const existingActiveProfilesMap = new Map();

  for (const p of existingProfiles) {
    if (p && p.esic_number && p.employee_id) {
      existingActiveProfilesMap.set(String(p.esic_number).trim(), String(p.employee_id).trim());
    }
  }

  const stagedRecords = [];
  const allExceptions = [];

  for (const rowItem of parsedRows) {
    const { isValid, stagedRecord, exceptions } = validateEsicRow(
      rowItem,
      currentBatchId,
      intraBatchEsicMap,
      existingActiveProfilesMap
    );

    if (isValid && stagedRecord) {
      stagedRecords.push(stagedRecord);
    } else {
      allExceptions.push(...exceptions);
    }
  }

  let status = 'SUCCESS';
  if (stagedRecords.length === 0 && allExceptions.length > 0) {
    status = 'FAILED';
  } else if (allExceptions.length > 0) {
    status = 'PARTIAL_SUCCESS';
  }

  return {
    batch_id: currentBatchId,
    total_rows: parsedRows.length,
    valid_rows_count: stagedRecords.length,
    exception_rows_count: new Set(allExceptions.map(e => e.row_number)).size,
    staged_records: stagedRecords,
    exceptions: allExceptions,
    status,
    processed_at: new Date().toISOString(),
  };
}
