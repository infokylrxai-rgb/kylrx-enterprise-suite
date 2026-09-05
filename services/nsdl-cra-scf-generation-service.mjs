/**
 * ============================================================================
 * KYLRX AI ENTERPRISE HRMS - NSDL / CRA SUBSCRIBER CONTRIBUTION FILE (SCF) SERVICE
 * ============================================================================
 * Features:
 *  1. Structural Record Mapping (Caret ^ delimiter):
 *     - File Header (FH): Record type, line counter, creation date/time, entity details
 *     - Batch Header (BH): Batch serial number, contribution month/year, total subscribers, total amount
 *     - Subscriber Detail (SD): PRAN (12 digits), employee share, employer share, total amount, type tag
 *     - File Trailer (FT): End of file marker with total line count, record count, grand hash totals
 *  2. Integrity & Checksum Engine:
 *     - Computes SHA-256 hash of compiled .txt SCF file
 *     - Persists structured metadata into ComplianceReturn (scheme: 'NPS')
 *     - Records audit trail execution in compliance_audit_logs
 *     - Emits downloadable file asset with MIME metadata and payload
 *
 * @version 3.4.0
 * @author Kylrx AI Principal Systems Architect & Lead Statutory Compliance Engineer
 */

import crypto from 'node:crypto';
import { isValidPranFormat } from './nps-batch-validation-pipeline.mjs';

/**
 * In-memory persistence stores for NPS Compliance Returns and Audit Logs.
 */
export const inMemoryNpsComplianceReturns = new Map();
export const inMemoryNpsAuditLogs = [];

/**
 * Resets in-memory stores for clean testing and state isolation.
 */
export function resetNpsComplianceStores() {
  inMemoryNpsComplianceReturns.clear();
  inMemoryNpsAuditLogs.length = 0;
}

/**
 * Normalizes period or month-year input to statutory MMYYYY string.
 *
 * @param {string|Date} periodInput
 * @returns {string} MMYYYY string (e.g. '092026')
 */
export function formatNpsMonthYear(periodInput) {
  if (!periodInput) {
    const now = new Date();
    const mm = String(now.getMonth() + 1).padStart(2, '0');
    const yyyy = now.getFullYear();
    return `${mm}${yyyy}`;
  }

  const str = String(periodInput).trim();

  // If already 6 digits MMYYYY
  if (/^\d{6}$/.test(str)) {
    return str;
  }

  // YYYY-MM or YYYY-MM-DD
  const isoMatch = str.match(/^(\d{4})-(\d{2})/);
  if (isoMatch) {
    const [, yyyy, mm] = isoMatch;
    return `${mm}${yyyy}`;
  }

  // MM/YYYY or DD/MM/YYYY
  const slashMatch = str.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (slashMatch) {
    const [, , mm, yyyy] = slashMatch;
    return `${mm.padStart(2, '0')}${yyyy}`;
  }
  const slashShort = str.match(/^(\d{1,2})\/(\d{4})$/);
  if (slashShort) {
    const [, mm, yyyy] = slashShort;
    return `${mm.padStart(2, '0')}${yyyy}`;
  }

  // Month Name Year (e.g. 'September 2026')
  const months = {
    january: '01', february: '02', march: '03', april: '04', may: '05', june: '06',
    july: '07', august: '08', september: '09', october: '10', november: '11', december: '12',
    jan: '01', feb: '02', mar: '03', apr: '04', jun: '06', jul: '07', aug: '08', sep: '09', oct: '10', nov: '11', dec: '12',
  };

  const nameMatch = str.match(/^([a-zA-Z]+)\s+(\d{4})$/);
  if (nameMatch) {
    const monthKey = nameMatch[1].toLowerCase();
    const year = nameMatch[2];
    if (months[monthKey]) {
      return `${months[monthKey]}${year}`;
    }
  }

  const date = new Date(str);
  if (!isNaN(date.getTime())) {
    const mm = String(date.getUTCMonth() + 1).padStart(2, '0');
    const yyyy = date.getUTCFullYear();
    return `${mm}${yyyy}`;
  }

  return '092026';
}

/**
 * Sanitizes input string for Caret (^) separated NSDL records.
 *
 * @param {any} val
 * @returns {string}
 */
export function sanitizeNsdlField(val) {
  if (val === null || val === undefined) return '';
  return String(val).replace(/[\^\r\n]/g, ' ').trim();
}

/**
 * Generates the standardized NSDL / CRA Subscriber Contribution File (.txt SCF format).
 *
 * @param {Object} params
 * @param {string} [params.corporateRegistrationNumber='CHO12345'] - Corporate Registration Number (CHO / CVO)
 * @param {string} [params.paoOrPopSpCode='POP00987'] - PAO / POP-SP entity code
 * @param {string} [params.entityName='KYLRX ENTERPRISE AI HRMS'] - Registered corporate entity name
 * @param {string} [params.period='September 2026'] - Payroll period description
 * @param {string} [params.monthYear] - MMYYYY string override
 * @param {string} [params.sourceRunId='RUN_PAYROLL_DEFAULT'] - Associated finalized payroll run ID
 * @param {string} [params.adminUser='admin@kylrx.ai'] - Executing statutory administrator
 * @param {Array<Object>} [params.records=[]] - Array of validated clean NPS calculation / staging records
 * @param {Object} [params.options={}] - Custom options (e.g. custom date, batch serial, persist flag)
 * @returns {Object} NPSSCFFileResult
 */
export function generateNsdlCraScfFile({
  corporateRegistrationNumber = 'CHO12345',
  paoOrPopSpCode = 'POP00987',
  entityName = 'KYLRX ENTERPRISE AI HRMS',
  period = 'September 2026',
  monthYear,
  sourceRunId = 'RUN_PAYROLL_DEFAULT',
  adminUser = 'admin@kylrx.ai',
  records = [],
  options = {},
}) {
  const normMonthYear = monthYear || formatNpsMonthYear(period);
  const now = options.creationDate instanceof Date ? options.creationDate : new Date();

  const creationDateStr = options.creationDateStr || (
    `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}`
  );
  const creationTimeStr = options.creationTimeStr || (
    `${String(now.getHours()).padStart(2, '0')}${String(now.getMinutes()).padStart(2, '0')}${String(now.getSeconds()).padStart(2, '0')}`
  );

  const fileRefNo = options.fileRefNo || `SCF${Date.now().toString().slice(-6)}`;
  const batchSerial = options.batchSerial || '001';

  const lines = [];

  // ==========================================================================
  // 1. FILE HEADER (FH)
  // Format: FH^Line_Counter^File_Type^Corporate_Reg_No^File_Ref_No^Creation_Date^Creation_Time^Entity_Name
  // ==========================================================================
  const fhLineCounter = '01';
  const fhLine = [
    'FH',
    fhLineCounter,
    'SCF',
    sanitizeNsdlField(corporateRegistrationNumber),
    sanitizeNsdlField(fileRefNo),
    creationDateStr,
    creationTimeStr,
    sanitizeNsdlField(entityName),
  ].join('^');

  lines.push(fhLine);

  // ==========================================================================
  // 2. SUBSCRIBER DETAIL RECORDS (SD)
  // Map and compile clean records
  // ==========================================================================
  let totalSubscriberCount = 0;
  let totalEmployerShare = 0;
  let totalEmployeeShare = 0;

  const sdLines = [];

  for (const [idx, rec] of records.entries()) {
    const pran = String(rec.pran || rec.nps_pran || '').trim();

    // Guard: Only valid 12-digit PRANs included
    if (!isValidPranFormat(pran)) {
      continue;
    }

    const employeeName = sanitizeNsdlField(
      rec.employee_name || rec.name || `Employee ${rec.employee_id || idx + 1}`
    );

    // Contribution components
    const employerContrib = Number(
      rec.employer_contribution !== undefined ? rec.employer_contribution :
      rec.employer_share !== undefined ? rec.employer_share :
      rec.employer_nps_share !== undefined ? rec.employer_nps_share :
      rec.er_contribution || 0
    );

    const employeeMandatory = Number(
      rec.employee_mandatory_deduction !== undefined ? rec.employee_mandatory_deduction :
      rec.employee_share !== undefined ? rec.employee_share :
      rec.employee_nps_share !== undefined ? rec.employee_nps_share :
      rec.ee_contribution || 0
    );

    const employeeVoluntary = Number(
      rec.employee_voluntary_contribution !== undefined ? rec.employee_voluntary_contribution :
      rec.voluntary_monthly_amount || 0
    );

    const totalEmployeeContrib = rec.total_employee_contribution !== undefined
      ? Number(rec.total_employee_contribution)
      : (employeeMandatory + employeeVoluntary);

    const totalLineContrib = rec.total_nps_contribution !== undefined
      ? Number(rec.total_nps_contribution)
      : (employerContrib + totalEmployeeContrib);

    if (totalLineContrib <= 0) {
      continue; // Skip zero contribution rows
    }

    totalSubscriberCount++;
    totalEmployerShare += employerContrib;
    totalEmployeeShare += totalEmployeeContrib;

    const contributionTypeTag = sanitizeNsdlField(rec.contribution_type || 'BOTH');
    const sdLineCounter = String(totalSubscriberCount);

    // Format: SD^Line_No^PRAN^Employee_Name^Employee_Share^Employer_Share^Total_Contribution^Contribution_Type^MonthYear
    const sdLine = [
      'SD',
      sdLineCounter,
      pran,
      employeeName,
      totalEmployeeContrib.toFixed(2),
      employerContrib.toFixed(2),
      totalLineContrib.toFixed(2),
      contributionTypeTag,
      normMonthYear,
    ].join('^');

    sdLines.push(sdLine);
  }

  const grandTotalAmount = totalEmployerShare + totalEmployeeShare;

  // ==========================================================================
  // 3. BATCH HEADER (BH)
  // Format: BH^Line_Counter^Batch_Serial^PAO_Code^Total_Subscribers^Total_Amount^MonthYear
  // ==========================================================================
  const bhLineCounter = '02';
  const bhLine = [
    'BH',
    bhLineCounter,
    batchSerial,
    sanitizeNsdlField(paoOrPopSpCode),
    String(totalSubscriberCount),
    grandTotalAmount.toFixed(2),
    normMonthYear,
  ].join('^');

  lines.push(bhLine);

  // Add all Subscriber Detail lines
  lines.push(...sdLines);

  // ==========================================================================
  // 4. FILE TRAILER (FT)
  // Format: FT^Line_Counter^Total_Batches^Total_Subscribers^Total_Lines^Grand_Total_Amount
  // ==========================================================================
  const totalFileLines = lines.length + 1; // including FT
  const ftLineCounter = '03';
  const ftLine = [
    'FT',
    ftLineCounter,
    '1', // Total Batches in this SCF
    String(totalSubscriberCount),
    String(totalFileLines),
    grandTotalAmount.toFixed(2),
  ].join('^');

  lines.push(ftLine);

  // Compile final file content (CRLF standard line terminators for NSDL gateway)
  const fileContent = lines.join('\r\n');
  const fileBuffer = Buffer.from(fileContent, 'utf8');
  const checksumSha256 = crypto.createHash('sha256').update(fileBuffer).digest('hex');

  const fileName = `NSDL_CRA_SCF_${corporateRegistrationNumber}_${normMonthYear}.txt`;
  const returnId = `RET_NPS_${normMonthYear}_${crypto.randomBytes(4).toString('hex')}`;
  const nowIso = new Date().toISOString();

  // ==========================================================================
  // 5. PERSISTENCE: ComplianceReturn & Audit Log
  // ==========================================================================
  const complianceReturn = {
    return_id: returnId,
    scheme: 'NPS',
    period,
    month_year: normMonthYear,
    corporate_registration_number: corporateRegistrationNumber,
    pao_pop_sp_code: paoOrPopSpCode,
    file_name: fileName,
    file_ref_no: fileRefNo,
    checksum_sha256: checksumSha256,
    row_count: totalSubscriberCount,
    total_subscribers: totalSubscriberCount,
    total_employee_share: Math.round(totalEmployeeShare * 100) / 100,
    total_employer_share: Math.round(totalEmployerShare * 100) / 100,
    total_amount: Math.round(grandTotalAmount * 100) / 100,
    source_payroll_run_id: sourceRunId,
    status: 'GENERATED',
    executing_admin: adminUser,
    created_at: nowIso,
  };

  const auditLogEntry = {
    log_id: `log_nps_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`,
    return_id: returnId,
    scheme: 'NPS',
    event: 'NSDL_CRA_SCF_GENERATED',
    file_name: fileName,
    checksum_sha256: checksumSha256,
    subscriber_count: totalSubscriberCount,
    total_amount: Math.round(grandTotalAmount * 100) / 100,
    source_payroll_run_id: sourceRunId,
    executed_by: adminUser,
    timestamp: nowIso,
  };

  if (options.persist !== false) {
    inMemoryNpsComplianceReturns.set(returnId, complianceReturn);
    inMemoryNpsAuditLogs.push(auditLogEntry);
  }

  return {
    file_type: 'NSDL_CRA_SCF_TXT',
    file_name: fileName,
    mime_type: 'text/plain',
    file_size_bytes: fileBuffer.length,
    content: fileContent,
    checksum_sha256: checksumSha256,
    compliance_return: complianceReturn,
    audit_log: auditLogEntry,
    summary: {
      corporate_registration_number: corporateRegistrationNumber,
      pao_code: paoOrPopSpCode,
      month_year: normMonthYear,
      total_lines: totalFileLines,
      total_subscribers: totalSubscriberCount,
      total_employee_contribution: Math.round(totalEmployeeShare * 100) / 100,
      total_employer_contribution: Math.round(totalEmployerShare * 100) / 100,
      total_nps_remittance: Math.round(grandTotalAmount * 100) / 100,
    },
  };
}

/**
 * Parses and verifies an NSDL / CRA Subscriber Contribution File string.
 *
 * @param {string} fileContent
 * @returns {Object} Parsed SCF inspection result
 */
export function parseNsdlCraScfFile(fileContent) {
  if (!fileContent || typeof fileContent !== 'string') {
    throw new Error('Valid SCF text content string is required for parsing.');
  }

  const rawLines = fileContent.split(/\r?\n/).filter((l) => l.trim().length > 0);
  let fh = null;
  let bh = null;
  let ft = null;
  const subscribers = [];

  for (const line of rawLines) {
    const parts = line.split('^');
    const recordType = parts[0];

    if (recordType === 'FH') {
      fh = {
        record_type: 'FH',
        line_counter: parts[1],
        file_type: parts[2],
        corporate_registration_number: parts[3],
        file_ref_no: parts[4],
        creation_date: parts[5],
        creation_time: parts[6],
        entity_name: parts[7] || '',
      };
    } else if (recordType === 'BH') {
      bh = {
        record_type: 'BH',
        line_counter: parts[1],
        batch_serial: parts[2],
        pao_code: parts[3],
        total_subscribers: parseInt(parts[4], 10),
        total_amount: parseFloat(parts[5]),
        month_year: parts[6],
      };
    } else if (recordType === 'SD') {
      subscribers.push({
        record_type: 'SD',
        line_number: parseInt(parts[1], 10),
        pran: parts[2],
        employee_name: parts[3],
        employee_share: parseFloat(parts[4]),
        employer_share: parseFloat(parts[5]),
        total_contribution: parseFloat(parts[6]),
        contribution_type: parts[7],
        month_year: parts[8],
      });
    } else if (recordType === 'FT') {
      ft = {
        record_type: 'FT',
        line_counter: parts[1],
        total_batches: parseInt(parts[2], 10),
        total_subscribers: parseInt(parts[3], 10),
        total_lines: parseInt(parts[4], 10),
        grand_total_amount: parseFloat(parts[5]),
      };
    }
  }

  const checksum = crypto.createHash('sha256').update(fileContent, 'utf8').digest('hex');

  return {
    is_valid_structure: Boolean(fh && bh && ft && subscribers.length === bh.total_subscribers),
    total_lines: rawLines.length,
    checksum_sha256: checksum,
    file_header: fh,
    batch_header: bh,
    subscriber_records: subscribers,
    file_trailer: ft,
  };
}

/**
 * Retrieves stored NPS compliance returns.
 *
 * @param {Object} [filter={}]
 * @returns {Array<Object>}
 */
export function getNpsComplianceReturns(filter = {}) {
  const all = Array.from(inMemoryNpsComplianceReturns.values());
  if (!filter || Object.keys(filter).length === 0) {
    return all;
  }
  return all.filter((r) => {
    if (filter.period && r.period !== filter.period) return false;
    if (filter.month_year && r.month_year !== filter.month_year) return false;
    if (filter.source_payroll_run_id && r.source_payroll_run_id !== filter.source_payroll_run_id) return false;
    return true;
  });
}

/**
 * Retrieves a single NPS compliance return by its unique return_id.
 *
 * @param {string} returnId
 * @returns {Object|null}
 */
export function getNpsComplianceReturnById(returnId) {
  return inMemoryNpsComplianceReturns.get(returnId) || null;
}
