/**
 * ============================================================================
 * KYLRX AI ENTERPRISE HRMS - MONTHLY ESIC RETURN & CHALLAN GENERATION SERVICE
 * ============================================================================
 * Features:
 *  1. Versioned Template Mapping Engine (Official ESIC Portal Layout V1.0)
 *  2. Multi-format compilation (CSV & Excel-compatible matrix)
 *  3. SHA-256 Checksum & ComplianceReturn Metadata Generation
 *  4. Immutable Compliance Audit Trail Logging to `compliance_audit_logs`
 *
 * @version 3.2.0
 * @author Kylrx AI Lead Systems Architect & Principal Backend Engineer
 */

import crypto from 'node:crypto';

/**
 * Canonical Versioned ESIC Portal Layout Definition.
 */
export const ESIC_PORTAL_LAYOUT_V1_0 = Object.freeze({
  layout_version: 'ESIC_PORTAL_LAYOUT_V1_0',
  description: 'Official Employees State Insurance Corporation Portal Monthly Return Layout',
  columns: [
    { field_key: 'ip_number', header_name: 'IP Number', description: '10-digit Insured Person Number', required: true },
    { field_key: 'ip_name', header_name: 'IP Name', description: 'Employee Full Name as registered on ESIC portal', required: true },
    { field_key: 'days_worked', header_name: 'No of Days for which wages paid', description: 'Payable / worked days in contribution month', required: true },
    { field_key: 'total_monthly_wages', header_name: 'Total Monthly Wages', description: 'Gross statutory wages earned in period', required: true },
    { field_key: 'reason_code_zero_days', header_name: 'Reason Code for Zero Working Days', description: 'Statutory reason code if working days is 0', required: false },
    { field_key: 'last_working_day', header_name: 'Last Working Day', description: 'Last working day (DD/MM/YYYY) if exited in period', required: false },
  ],
});

/**
 * In-memory fallback stores for Compliance Returns and Audit Logs.
 */
export const inMemoryComplianceReturns = new Map();
export const inMemoryComplianceAuditLogs = [];

/**
 * Clears in-memory audit logs and returns (useful for test isolation).
 */
export function resetComplianceStores() {
  inMemoryComplianceReturns.clear();
  inMemoryComplianceAuditLogs.length = 0;
}

/**
 * Sanitizes and formats text strings for safe CSV/Excel inclusion.
 * Wraps values in quotes and escapes internal double-quotes.
 *
 * @param {string|number|null|undefined} val
 * @returns {string}
 */
export function sanitizeCsvField(val) {
  if (val === null || val === undefined) return '';
  const str = String(val).trim();
  if (str.includes(',') || str.includes('"') || str.includes('\n') || str.includes('\r')) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

/**
 * Normalizes date to statutory DD/MM/YYYY format or returns empty string.
 *
 * @param {string|null|undefined} dateStr
 * @returns {string}
 */
export function formatStatutoryDate(dateStr) {
  if (!dateStr || typeof dateStr !== 'string') return '';
  const trimmed = dateStr.trim();
  if (!trimmed) return '';

  // Check if already DD/MM/YYYY
  if (/^\d{2}\/\d{2}\/\d{4}$/.test(trimmed)) {
    return trimmed;
  }

  // Check ISO YYYY-MM-DD
  const isoMatch = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (isoMatch) {
    const [, yyyy, mm, dd] = isoMatch;
    return `${dd}/${mm}/${yyyy}`;
  }

  return trimmed;
}

/**
 * Maps and validates a single calculation record to the ESIC portal layout.
 *
 * @param {Object} record - Employee calculation record
 * @returns {Object} Normalized portal row data
 */
export function mapRecordToPortalLayout(record) {
  const ipNumber = String(
    record.esic_number || record.ip_number || record.esic_ip_number || ''
  ).trim();

  const ipName = String(
    record.employee_name || record.name || record.ip_name || `Employee ${record.employee_id || ''}`
  ).trim();

  // Days worked: defaults to payable_days, days_worked, or 30
  let daysWorked = 30;
  if (record.days_worked !== undefined && record.days_worked !== null) {
    daysWorked = Number(record.days_worked);
  } else if (record.payable_days !== undefined && record.payable_days !== null) {
    daysWorked = Number(record.payable_days);
  } else if (record.no_of_days_worked !== undefined && record.no_of_days_worked !== null) {
    daysWorked = Number(record.no_of_days_worked);
  }

  if (isNaN(daysWorked) || daysWorked < 0) daysWorked = 0;
  if (daysWorked > 31) daysWorked = 31;

  // Gross Wages
  const grossWages = Number(
    record.gross_wages !== undefined ? record.gross_wages :
    record.gross_earnings !== undefined ? record.gross_earnings :
    record.wages !== undefined ? record.wages : 0
  ) || 0;

  // Zero days reason code (mandatory or specified if daysWorked === 0)
  let zeroDaysReason = '';
  if (daysWorked === 0) {
    zeroDaysReason = String(record.zero_days_reason_code || record.reason_code_zero_days || '1').trim();
  }

  // Last working day
  const lastWorkingDay = formatStatutoryDate(record.last_working_day || record.date_of_exit || '');

  // Contribution shares (dynamic or fallback to standard rates)
  const eeShare = record.employee_deduction !== undefined
    ? Number(record.employee_deduction)
    : Math.round(grossWages * 0.0075);

  const erShare = record.employer_contribution !== undefined
    ? Number(record.employer_contribution)
    : Math.round(grossWages * 0.0325);

  return {
    raw_record: record,
    ip_number: ipNumber,
    ip_name: ipName,
    days_worked: daysWorked,
    total_monthly_wages: grossWages,
    reason_code_zero_days: zeroDaysReason,
    last_working_day: lastWorkingDay,
    employee_share: eeShare,
    employer_share: erShare,
  };
}

/**
 * Compiles mapped records into official ESIC CSV string.
 *
 * @param {Array<Object>} mappedRows
 * @param {Object} [layoutConfig=ESIC_PORTAL_LAYOUT_V1_0]
 * @returns {string}
 */
export function compileEsicPortalCsv(mappedRows, layoutConfig = ESIC_PORTAL_LAYOUT_V1_0) {
  const headers = layoutConfig.columns.map(c => c.header_name).join(',');
  const rows = mappedRows.map(row => {
    return [
      row.ip_number,
      `"${row.ip_name.replace(/"/g, '""')}"`,
      row.days_worked,
      row.total_monthly_wages.toFixed(2),
      row.reason_code_zero_days,
      row.last_working_day,
    ].join(',');
  });

  return [headers, ...rows].join('\r\n');
}

/**
 * Generates an Excel-compatible matrix structure (array of column objects / arrays).
 *
 * @param {Array<Object>} mappedRows
 * @param {Object} [layoutConfig=ESIC_PORTAL_LAYOUT_V1_0]
 * @returns {Array<Array<any>>}
 */
export function compileEsicExcelMatrix(mappedRows, layoutConfig = ESIC_PORTAL_LAYOUT_V1_0) {
  const headerRow = layoutConfig.columns.map(c => c.header_name);
  const dataRows = mappedRows.map(row => [
    row.ip_number,
    row.ip_name,
    row.days_worked,
    Number(row.total_monthly_wages.toFixed(2)),
    row.reason_code_zero_days,
    row.last_working_day,
  ]);

  return [headerRow, ...dataRows];
}

/**
 * Core Service to generate Monthly ESIC Return, Compute SHA-256 Checksums,
 * construct ComplianceReturn metadata, and write to compliance_audit_logs.
 *
 * @param {Object} params
 * @param {string} params.employer_code - 17-digit ESIC Employer Code (e.g., '31000123450000999')
 * @param {string} params.period - Period name or ISO month (e.g., 'September 2026' or '2026-09')
 * @param {string} params.source_payroll_run_id - Source Payroll Run ID
 * @param {Array<Object>} params.validated_calculations - List of compliant calculation records
 * @param {string} [params.admin_id='SYSTEM_ADMIN'] - Executing administrator ID
 * @param {string|number} [params.policy_version_applied='ESIC_POL_2019_V1'] - Policy version applied
 * @param {Object} [params.options] - Custom options and persistence hooks
 * @returns {Promise<Object>} Generated return manifest, file content, compliance return entity, and audit log
 */
export async function generateMonthlyEsicReturnAndChallan({
  employer_code = '31000123450000999',
  period = 'September 2026',
  source_payroll_run_id,
  validated_calculations = [],
  admin_id = 'SYSTEM_ADMIN',
  policy_version_applied = 'ESIC_POL_2019_V1',
  options = {},
}) {
  if (!source_payroll_run_id) {
    throw new Error('source_payroll_run_id is required to generate ESIC Return & Challan.');
  }

  const layout = options.layout_schema || ESIC_PORTAL_LAYOUT_V1_0;

  // 1. Template Mapping Engine: map validated records to portal layout
  const mappedRows = [];
  let totalWages = 0;
  let totalEmployeeShare = 0;
  let totalEmployerShare = 0;

  for (const calc of validated_calculations) {
    const mapped = mapRecordToPortalLayout(calc);
    mappedRows.push(mapped);

    totalWages += mapped.total_monthly_wages;
    totalEmployeeShare += mapped.employee_share;
    totalEmployerShare += mapped.employer_share;
  }

  // 2. Format & Compile File
  const csvContent = compileEsicPortalCsv(mappedRows, layout);
  const excelMatrix = compileEsicExcelMatrix(mappedRows, layout);

  // 3. Integrity & SHA-256 Checksum
  const checksum = crypto.createHash('sha256').update(csvContent, 'utf8').digest('hex');
  const fileSize = Buffer.byteLength(csvContent, 'utf8');

  // Format safe file name: ESIC_RETURN_<EMPLOYER_CODE>_<PERIOD_TAG>.csv
  const sanitizedPeriod = period.replace(/[^a-zA-Z0-9]/g, '_');
  const fileName = `ESIC_RETURN_${employer_code}_${sanitizedPeriod}.csv`;

  // 4. Build ComplianceReturn Entity
  const returnId = options.return_id || `esic_ret_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
  const totalChallanAmount = totalEmployeeShare + totalEmployerShare;

  const complianceReturn = {
    return_id: returnId,
    scheme: 'ESIC',
    period,
    file_name: fileName,
    checksum,
    row_count: mappedRows.length,
    total_employee_share: totalEmployeeShare,
    total_employer_share: totalEmployerShare,
    total_challan_amount: totalChallanAmount,
    source_payroll_run_id,
    policy_version_applied,
    layout_version: layout.layout_version,
    status: options.initial_status || 'GENERATED',
    created_at: new Date().toISOString(),
    created_by: admin_id,
  };

  // 5. Build Audit Trail Record
  const logId = options.log_id || `audit_esic_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
  const auditLogRecord = {
    log_id: logId,
    admin_id,
    action: 'ESIC_RETURN_GENERATED',
    scheme: 'ESIC',
    period,
    source_payroll_run_id,
    input_calculation_parameters: {
      employer_code,
      wage_month: period,
      policy_version_applied,
      total_candidates: validated_calculations.length,
      total_eligible_wages: Math.round(totalWages * 100) / 100,
    },
    submission_status: complianceReturn.status,
    raw_output_file_metadata: {
      file_name: fileName,
      checksum,
      file_size_bytes: fileSize,
      row_count: mappedRows.length,
      total_employee_share: totalEmployeeShare,
      total_employer_share: totalEmployerShare,
      total_challan_amount: totalChallanAmount,
    },
    timestamp: new Date().toISOString(),
  };

  // 6. Persistence to In-Memory store or Custom Handlers
  if (typeof options.saveComplianceReturn === 'function') {
    await options.saveComplianceReturn(complianceReturn);
  } else {
    inMemoryComplianceReturns.set(returnId, complianceReturn);
  }

  if (typeof options.saveAuditLog === 'function') {
    await options.saveAuditLog(auditLogRecord);
  } else {
    inMemoryComplianceAuditLogs.push(auditLogRecord);
  }

  return {
    success: true,
    return_id: returnId,
    compliance_return: complianceReturn,
    audit_log: auditLogRecord,
    file: {
      file_name: fileName,
      mime_type: 'text/csv',
      content: csvContent,
      excel_matrix: excelMatrix,
      checksum_sha256: checksum,
      file_size_bytes: fileSize,
    },
    summary: {
      total_records: mappedRows.length,
      total_wages: Math.round(totalWages * 100) / 100,
      total_employee_share: totalEmployeeShare,
      total_employer_share: totalEmployerShare,
      total_challan_amount: totalChallanAmount,
    },
  };
}
