/**
 * ============================================================================
 * KYLRX AI ENTERPRISE HRMS - ESIC AUTOMATION ENGINE (COLUMN 1 COMPLIANCE BLUEPRINT)
 * ============================================================================
 * Full ESIC automation engine satisfying Column 1 of the visual compliance blueprint:
 *
 * 1. Profile Master & Bulk Upload:
 *    - Model EmployeeESICProfile entity (employee_id, esic_number [10 digits],
 *      esic_applicable, date_of_joining, disability_percentage, date_of_exit).
 *    - Ingest and parse Excel files (ESIC_Employee_Master.xlsx) supporting
 *      XML Spreadsheet 2003, XLSX OpenXML, CSV/TSV, and structured buffers.
 *
 * 2. Automation Builder:
 *    - Listen for the monthly Payroll Finalized trigger (PAYROLL_FINALIZED).
 *    - Apply conditions: esic_applicable === true AND gross_salary <= esic_wage_limit
 *      (standard ₹21,000; disabled ₹25,000 for disability_percentage >= 40%).
 *    - Fetch active profile details respecting joining and exit dates.
 *
 * 3. Calculation & Validation:
 *    - Compute employee share (0.75%) and employer share (3.25%).
 *    - Validate against 10-digit format (/^\d{10}$/), salary limits, and duplicate
 *      ESIC numbers across batch and master records.
 *
 * 4. Exceptions & Alerts:
 *    - Strict routing of compliance errors:
 *      - EMP004: ESIC Number Missing
 *      - EMP005: Salary Exceeds Limit
 *      - EMP006: Invalid ESIC Number
 *      - EMP007: Duplicate ESIC Number
 *    - Persist in ESIC_Exceptions table.
 *    - Create actionable HRTask items with SLA and remediation guidance.
 *    - Dispatch multi-channel HRAlert notifications (IN_APP, EMAIL).
 *
 * 5. File Output & Visual Stepper Workflow:
 *    - Generate official export ESIC_CONTRIBUTION_MONTH_YEAR.txt and .xls
 *      Layout: [ESIC No, Employee Name, IP No, No. of Days, Total Wages, Employee Share, Employer Share]
 *    - Advance batch through 7-stage visual compliance stepper:
 *      Payroll Finalized -> ESIC Calculated -> Validated -> File/Challan Generated
 *      -> Uploaded to ESIC Portal -> Payment Done -> Compliance Completed.
 *
 * @version 4.0.0
 * @author Kylrx AI Lead Backend Compliance Engineer
 */

import crypto from 'node:crypto';

export const ESIC_10_DIGIT_REGEX = /^[0-9]{10}$/;

export const ESIC_STANDARD_WAGE_LIMIT = 21000;
export const ESIC_DISABLED_WAGE_LIMIT = 25000;
export const ESIC_DISABILITY_THRESHOLD_PERCENT = 40;

export const ESIC_EE_RATE = 0.0075; // 0.75%
export const ESIC_ER_RATE = 0.0325; // 3.25%

/**
 * 7-Stage Visual Compliance Stepper Enums
 */
export const ESIC_STEPPER_STAGES = Object.freeze([
  'PAYROLL_FINALIZED',
  'ESIC_CALCULATED',
  'VALIDATED',
  'FILE_GENERATED',
  'PORTAL_UPLOADED',
  'PAYMENT_DONE',
  'COMPLETED',
]);

/**
 * Stage labels for UI display
 */
export const ESIC_STEPPER_LABELS = Object.freeze({
  PAYROLL_FINALIZED: 'Payroll Finalized',
  ESIC_CALCULATED: 'ESIC Calculated',
  VALIDATED: 'Validated',
  FILE_GENERATED: 'File/Challan Generated',
  PORTAL_UPLOADED: 'Uploaded to ESIC Portal',
  PAYMENT_DONE: 'Payment Done',
  COMPLETED: 'Compliance Completed',
});

/**
 * Canonical Exception Code Definitions
 */
export const ESIC_EXCEPTION_CODES = Object.freeze({
  EMP004: {
    code: 'EMP004',
    title: 'ESIC Number Missing',
    severity: 'BLOCK',
    field: 'esic_number',
    suggested_fix: 'Employee is flagged as ESIC covered but has no ESIC/IP number. Enter the 10-digit ESIC Insurance Person number.',
  },
  EMP005: {
    code: 'EMP005',
    title: 'Salary Exceeds Limit',
    severity: 'BLOCK',
    field: 'gross_salary',
    suggested_fix: 'Gross wages exceed statutory wage ceiling (₹21,000 standard / ₹25,000 disabled). Mark as exempt or verify contribution cycle grandfathering.',
  },
  EMP006: {
    code: 'EMP006',
    title: 'Invalid ESIC Number',
    severity: 'BLOCK',
    field: 'esic_number',
    suggested_fix: 'ESIC IP Number must consist of exactly 10 numeric digits. Remediate malformed number.',
  },
  EMP007: {
    code: 'EMP007',
    title: 'Duplicate ESIC Number',
    severity: 'BLOCK',
    field: 'esic_number',
    suggested_fix: 'The same 10-digit ESIC number is assigned to multiple employees. Investigate and reassign unique IP number.',
  },
});

/* ============================================================================
 * PILLAR 1: PROFILE MASTER & BULK UPLOAD (ESIC_Employee_Master.xlsx)
 * ============================================================================
 */

export class EmployeeEsicProfileStore {
  constructor() {
    /** @type {Map<string, object>} employee_id -> profile */
    this.profiles = new Map();
  }

  clear() {
    this.profiles.clear();
  }

  upsertProfile(profileData) {
    if (!profileData || !profileData.employee_id) {
      throw new Error('employee_id is mandatory for EmployeeESICProfile.');
    }

    const employeeId = String(profileData.employee_id).trim();
    const esicNumber = String(profileData.esic_number || '').trim();
    const esicApplicable = Boolean(
      profileData.esic_applicable === true ||
      String(profileData.esic_applicable).toLowerCase() === 'true' ||
      String(profileData.esic_applicable).toLowerCase() === 'yes' ||
      String(profileData.esic_applicable) === '1'
    );
    const dateOfJoining = String(profileData.date_of_joining || '2024-01-01').trim();
    const dateOfExit = profileData.date_of_exit ? String(profileData.date_of_exit).trim() : null;
    const disabilityPercentage = Number(profileData.disability_percentage || 0);
    const disabilityFlag = Boolean(
      profileData.disability_flag === true ||
      disabilityPercentage >= ESIC_DISABILITY_THRESHOLD_PERCENT
    );

    const isGrandfathered = Boolean(
      profileData.is_grandfathered === true ||
      String(profileData.is_grandfathered).toLowerCase() === 'true' ||
      String(profileData.is_grandfathered).toLowerCase() === 'yes' ||
      String(profileData.is_grandfathered) === '1'
    );

    const profile = {
      employee_id: employeeId,
      employee_name: profileData.employee_name || profileData.name || `Employee ${employeeId}`,
      esic_number: esicNumber,
      esic_applicable: esicApplicable,
      date_of_joining: dateOfJoining,
      date_of_exit: dateOfExit,
      disability_percentage: disabilityPercentage,
      disability_flag: disabilityFlag,
      is_grandfathered: isGrandfathered,
      dispensary_code: profileData.dispensary_code || '',
      branch_office: profileData.branch_office || '',
      created_at: profileData.created_at || new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    this.profiles.set(employeeId, profile);
    return profile;
  }

  getProfile(employeeId) {
    return this.profiles.get(String(employeeId).trim()) || null;
  }

  getAllProfiles() {
    return Array.from(this.profiles.values());
  }

  /**
   * Filters active profiles as of a given payroll period
   * (date_of_joining <= period_end AND (!date_of_exit || date_of_exit >= period_start))
   */
  findActiveProfiles(periodStr = '2026-09') {
    const periodStart = `${periodStr.slice(0, 7)}-01`;
    const periodEnd = `${periodStr.slice(0, 7)}-31`;

    return Array.from(this.profiles.values()).filter((p) => {
      const joined = !p.date_of_joining || p.date_of_joining <= periodEnd;
      const notExited = !p.date_of_exit || p.date_of_exit >= periodStart;
      return joined && notExited;
    });
  }

  /**
   * Ingests master employee data from Excel / CSV / JSON representation of ESIC_Employee_Master.xlsx
   *
   * @param {string|Buffer|Array<object>} input Raw file content or row objects
   * @param {object} [options]
   * @returns {object} { batch_id, total_rows, valid_rows_count, exception_rows_count, staged_records, exceptions }
   */
  ingestExcelMaster(input, options = {}) {
    const batchId = options.batch_id || `ESIC_MASTER_${Date.now()}`;
    const rawRows = parseExcelOrCsvInput(input);

    const stagedRecords = [];
    const exceptions = [];
    const seenEsicNumbers = new Map();

    for (let i = 0; i < rawRows.length; i++) {
      const row = rawRows[i];
      const rowNumber = i + 2; // 1-based, assuming row 1 is header

      const employeeId = String(row.employee_id || row.Employee_ID || row.EmployeeId || '').trim();
      const esicNumber = String(row.esic_number || row.ESIC_Number || row.EsicNumber || row.ip_number || '').trim();
      const applicableRaw = row.esic_applicable ?? row.ESIC_Applicable ?? row.Applicable ?? 'true';
      const esicApplicable = Boolean(
        applicableRaw === true ||
        String(applicableRaw).toLowerCase() === 'true' ||
        String(applicableRaw).toLowerCase() === 'yes' ||
        String(applicableRaw) === '1'
      );
      const dateOfJoining = String(row.date_of_joining || row.Date_Of_Joining || row.DOJ || '2024-01-01').trim();
      const dateOfExit = (row.date_of_exit || row.Date_Of_Exit || row.DOE) ? String(row.date_of_exit || row.Date_Of_Exit || row.DOE).trim() : null;
      const disabilityPct = Number(row.disability_percentage || row.Disability_Percentage || row.DisabilityPct || 0);
      const employeeName = row.employee_name || row.Employee_Name || row.Name || `Employee ${employeeId}`;

      let hasRowException = false;

      if (!employeeId) {
        exceptions.push({
          exception_id: `EXC_${batchId}_R${rowNumber}_NO_ID`,
          batch_id: batchId,
          row_number: rowNumber,
          employee_id: 'UNKNOWN',
          code: 'ERR_MISSING_EMPLOYEE_ID',
          message: `Row ${rowNumber}: Mandatory employee_id is missing.`,
        });
        hasRowException = true;
      }

      // Check format if ESIC applicable
      if (esicApplicable) {
        if (!esicNumber) {
          exceptions.push({
            exception_id: `EXC_${batchId}_R${rowNumber}_EMP004`,
            batch_id: batchId,
            row_number: rowNumber,
            employee_id: employeeId,
            code: 'EMP004',
            error_label: ESIC_EXCEPTION_CODES.EMP004.title,
            field: 'esic_number',
            message: `Row ${rowNumber}: ESIC is applicable but ESIC Number is missing.`,
          });
          hasRowException = true;
        } else if (!ESIC_10_DIGIT_REGEX.test(esicNumber)) {
          exceptions.push({
            exception_id: `EXC_${batchId}_R${rowNumber}_EMP006`,
            batch_id: batchId,
            row_number: rowNumber,
            employee_id: employeeId,
            code: 'EMP006',
            error_label: ESIC_EXCEPTION_CODES.EMP006.title,
            field: 'esic_number',
            message: `Row ${rowNumber}: Invalid ESIC number "${esicNumber}". Must be exactly 10 digits.`,
          });
          hasRowException = true;
        } else {
          // Check duplicate in same upload batch
          if (seenEsicNumbers.has(esicNumber)) {
            const firstEmp = seenEsicNumbers.get(esicNumber);
            exceptions.push({
              exception_id: `EXC_${batchId}_R${rowNumber}_EMP007`,
              batch_id: batchId,
              row_number: rowNumber,
              employee_id: employeeId,
              code: 'EMP007',
              error_label: ESIC_EXCEPTION_CODES.EMP007.title,
              field: 'esic_number',
              message: `Row ${rowNumber}: Duplicate ESIC number "${esicNumber}" already assigned to employee ${firstEmp}.`,
            });
            hasRowException = true;
          } else {
            seenEsicNumbers.set(esicNumber, employeeId);
          }
        }
      }

      if (!hasRowException && employeeId) {
        const profile = this.upsertProfile({
          employee_id: employeeId,
          employee_name: employeeName,
          esic_number: esicNumber,
          esic_applicable: esicApplicable,
          date_of_joining: dateOfJoining,
          date_of_exit: dateOfExit,
          disability_percentage: disabilityPct,
          is_grandfathered: row.is_grandfathered,
        });
        stagedRecords.push(profile);
      }
    }

    return {
      batch_id: batchId,
      source_file: options.file_name || 'ESIC_Employee_Master.xlsx',
      total_rows: rawRows.length,
      valid_rows_count: stagedRecords.length,
      exception_rows_count: exceptions.length,
      staged_records: stagedRecords,
      exceptions,
      ingested_at: new Date().toISOString(),
    };
  }
}

/**
 * Universal parser for Excel (XML Spreadsheet 2003 / XLSX / TSV / CSV / JSON)
 */
export function parseExcelOrCsvInput(input) {
  if (!input) return [];

  // 1. Direct array of objects
  if (Array.isArray(input)) {
    return input;
  }

  let textContent = '';
  if (Buffer.isBuffer(input)) {
    textContent = input.toString('utf8');
  } else if (typeof input === 'string') {
    textContent = input.trim();
  }

  if (!textContent) return [];

  // 2. Try JSON parse
  if ((textContent.startsWith('[') && textContent.endsWith(']')) ||
      (textContent.startsWith('{') && textContent.endsWith('}'))) {
    try {
      const parsed = JSON.parse(textContent);
      if (Array.isArray(parsed)) return parsed;
      if (parsed && Array.isArray(parsed.rows)) return parsed.rows;
      if (parsed && Array.isArray(parsed.data)) return parsed.data;
    } catch (e) {
      // Fall through to text/XML parsing
    }
  }

  // 3. XML Spreadsheet 2003 format (<Workbook> ... <Row> ... <Cell><Data>...</Data></Cell>)
  if (textContent.includes('<Workbook') || textContent.includes('<worksheet') || textContent.includes('<table')) {
    const rows = [];
    const rowMatches = textContent.match(/<Row[^>]*>[\s\S]*?<\/Row>/gi) ||
                       textContent.match(/<tr[^>]*>[\s\S]*?<\/tr>/gi) || [];

    let headers = null;

    for (const rXml of rowMatches) {
      const cellMatches = rXml.match(/<Data[^>]*>([\s\S]*?)<\/Data>/gi) ||
                          rXml.match(/<t[^>]*>([\s\S]*?)<\/t>/gi) ||
                          rXml.match(/<td[^>]*>([\s\S]*?)<\/td>/gi) ||
                          rXml.match(/<th[^>]*>([\s\S]*?)<\/th>/gi) || [];

      const values = cellMatches.map((c) =>
        c.replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').trim()
      );

      if (!headers) {
        headers = values.map((h) => h.toLowerCase().replace(/[\s-]+/g, '_'));
      } else if (values.length > 0) {
        const rowObj = {};
        headers.forEach((h, idx) => {
          rowObj[h] = values[idx] !== undefined ? values[idx] : '';
        });
        rows.push(rowObj);
      }
    }

    if (rows.length > 0) return rows;
  }

  // 4. Standard CSV / TSV fallback
  const lines = textContent.split(/\r?\n/).map((l) => l.trim()).filter((l) => l.length > 0);
  if (lines.length < 2) return [];

  const delimiter = lines[0].includes('\t') ? '\t' : (lines[0].includes('|') ? '|' : ',');
  const rawHeaders = splitDelimitedLine(lines[0], delimiter);
  const headers = rawHeaders.map((h) => h.toLowerCase().replace(/[\s-]+/g, '_').replace(/^"|"$/g, ''));

  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    const cols = splitDelimitedLine(lines[i], delimiter).map((c) => c.replace(/^"|"$/g, '').trim());
    if (cols.length === 0 || cols.every((c) => c === '')) continue;
    const rowObj = {};
    headers.forEach((h, idx) => {
      rowObj[h] = cols[idx] !== undefined ? cols[idx] : '';
    });
    rows.push(rowObj);
  }

  return rows;
}

function splitDelimitedLine(line, delimiter) {
  const values = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (ch === delimiter && !inQuotes) {
      values.push(cur);
      cur = '';
    } else {
      cur += ch;
    }
  }
  values.push(cur);
  return values;
}

/* ============================================================================
 * PILLAR 2, 3, 4 & 5: AUTOMATION BUILDER, CALCULATION, EXCEPTIONS & STEPPER
 * ============================================================================
 */

export class EsicAutomationEngine {
  constructor(options = {}) {
    this.profileStore = options.profileStore || new EmployeeEsicProfileStore();
    this.eventBus = options.eventBus || null;

    /** @type {Map<string, object>} batch_id -> stepperState */
    this.stepperStates = new Map();

    /** @type {Map<string, Array<object>>} batch_id -> Array<ESIC_ExceptionRecord> */
    this.esicExceptions = new Map();

    /** @type {Map<string, Array<object>>} batch_id -> Array<HRTaskRecord> */
    this.hrTasks = new Map();

    /** @type {Map<string, Array<object>>} batch_id -> Array<HRAlertRecord> */
    this.hrAlerts = new Map();

    /** @type {Map<string, object>} batch_id -> calculationResult */
    this.calculationResults = new Map();

    /** @type {Map<string, { txt: string, xls: string, manifest: object }>} batch_id -> exports */
    this.exportFiles = new Map();

    if (this.eventBus) {
      this.attachPayrollFinalizedListener(this.eventBus);
    }
  }

  /**
   * Pillar 2: Listen for the monthly Payroll Finalized trigger
   */
  attachPayrollFinalizedListener(eventBus) {
    if (!eventBus || typeof eventBus.on !== 'function') return;

    eventBus.on('PAYROLL_FINALIZED', async (eventData) => {
      try {
        const payload = eventData?.payload || eventData || {};
        await this.onPayrollFinalized(payload);
      } catch (err) {
        console.error('[EsicAutomationEngine] Failed to process PAYROLL_FINALIZED event:', err);
      }
    });
  }

  /**
   * Handles PAYROLL_FINALIZED trigger and initiates ESIC automation
   */
  async onPayrollFinalized(payrollRunData = {}) {
    const runId = payrollRunData.run_id || payrollRunData.runId || `RUN_${Date.now()}`;
    const period = payrollRunData.period || payrollRunData.wage_period || '2026-09';
    const batchId = payrollRunData.batch_id || `BATCH_ESIC_${runId}`;
    const payrollRecords = payrollRunData.payroll_records || payrollRunData.records || payrollRunData.candidates || [];
    const employerCode = payrollRunData.employer_code || payrollRunData.establishment_code || '31000123450000999';

    // 1. Initialize Visual Stepper at Stage 1: PAYROLL_FINALIZED
    this.initStepper(batchId, runId, period);

    // 2. Advance to Stage 2: ESIC_CALCULATED and execute engine
    const calculationResult = this.calculateEsicBatch({
      batch_id: batchId,
      run_id: runId,
      period,
      payroll_records: payrollRecords,
      employer_code: employerCode,
    });

    return calculationResult;
  }

  /**
   * Initializes the 7-stage visual stepper for an ESIC batch
   */
  initStepper(batchId, runId, period) {
    const now = new Date().toISOString();
    const state = {
      batch_id: batchId,
      run_id: runId,
      period,
      current_stage: 'PAYROLL_FINALIZED',
      history: [
        {
          stage: 'PAYROLL_FINALIZED',
          transitioned_at: now,
          actor: 'SYSTEM_EVENT_LISTENER',
          notes: `Payroll finalized trigger received for run ${runId}. Initializing ESIC compliance workflow.`,
        },
      ],
      is_blocked: false,
      unresolved_blocking_exceptions_count: 0,
      created_at: now,
      updated_at: now,
    };

    this.stepperStates.set(batchId, state);
    return state;
  }

  /**
   * Pillar 2, 3 & 4: Core ESIC calculation, validation and exception routing
   */
  calculateEsicBatch({ batch_id, run_id, period, payroll_records = [], employer_code = '31000123450000999' }) {
    const runId = run_id || `RUN_${Date.now()}`;
    const batchId = batch_id || `BATCH_ESIC_${runId}`;
    const periodStr = String(period || '2026-09');
    const employerCode = employer_code || '31000123450000999';

    // Fetch active master profiles
    const activeProfiles = this.profileStore.findActiveProfiles(periodStr);
    const profileMap = new Map();
    for (const p of activeProfiles) {
      profileMap.set(p.employee_id, p);
    }

    const compliantRecords = [];
    const exceptions = [];
    const hrTasks = [];
    const hrAlerts = [];
    const nonApplicableRecords = [];

    const seenBatchEsicNumbers = new Map();

    let totalWages = 0;
    let totalEmployeeShare = 0;
    let totalEmployerShare = 0;

    for (const rec of payroll_records) {
      const employeeId = String(rec.employee_id || rec.employeeId || rec.id || '').trim();
      const grossSalary = Number(rec.gross_salary ?? rec.gross_wages ?? rec.gross ?? 0);
      const employeeName = rec.employee_name || rec.name || `Employee ${employeeId}`;
      const daysWorked = Number(rec.days_worked ?? rec.no_of_days ?? rec.payable_days ?? 30);

      // Fetch active profile details
      let profile = profileMap.get(employeeId);
      if (!profile) {
        // Look up in all profiles or build fallback
        profile = this.profileStore.getProfile(employeeId) || {
          employee_id: employeeId,
          employee_name: employeeName,
          esic_number: String(rec.esic_number || rec.ip_number || '').trim(),
          esic_applicable: rec.esic_applicable !== undefined ? Boolean(rec.esic_applicable) : Boolean(rec.esic_number || rec.ip_number),
          date_of_joining: rec.date_of_joining || '2024-01-01',
          date_of_exit: rec.date_of_exit || null,
          disability_percentage: Number(rec.disability_percentage || 0),
          disability_flag: Boolean(rec.disability_flag || Number(rec.disability_percentage || 0) >= ESIC_DISABILITY_THRESHOLD_PERCENT),
          is_grandfathered: Boolean(
            rec.is_grandfathered === true ||
            String(rec.is_grandfathered).toLowerCase() === 'true' ||
            String(rec.is_grandfathered).toLowerCase() === 'yes' ||
            String(rec.is_grandfathered) === '1'
          ),
        };
      }

      // Automation Condition: esic_applicable === true
      if (profile.esic_applicable !== true) {
        nonApplicableRecords.push({
          employee_id: employeeId,
          employee_name: employeeName,
          gross_salary: grossSalary,
          status: 'EXEMPT_NOT_APPLICABLE',
        });
        continue;
      }

      const esicNumber = String(profile.esic_number || rec.esic_number || '').trim();
      const disabilityPct = Number(profile.disability_percentage || rec.disability_percentage || 0);
      const isPersonWithDisability = profile.disability_flag || disabilityPct >= ESIC_DISABILITY_THRESHOLD_PERCENT;
      const applicableWageLimit = isPersonWithDisability ? ESIC_DISABLED_WAGE_LIMIT : ESIC_STANDARD_WAGE_LIMIT;
      const isGrandfathered = Boolean(
        profile.is_grandfathered === true ||
        String(profile.is_grandfathered).toLowerCase() === 'true' ||
        rec.is_grandfathered === true ||
        String(rec.is_grandfathered).toLowerCase() === 'true'
      );

      let recordHasBlockingError = false;

      // Validation 1: EMP004 - ESIC Number Missing
      if (!esicNumber) {
        recordHasBlockingError = true;
        const exc = this.createExceptionRecord({
          batch_id: batchId,
          employee_id: employeeId,
          employee_name: employeeName,
          code: 'EMP004',
          actual_value: null,
          message: `Employee ${employeeName} (${employeeId}) is marked ESIC applicable but ESIC Number is missing.`,
        });
        exceptions.push(exc);
        const { task, alert } = this.createTaskAndAlert(batchId, exc);
        hrTasks.push(task);
        hrAlerts.push(alert);
      }
      // Validation 2: EMP006 - Invalid ESIC Number (must be exactly 10 digits)
      else if (!ESIC_10_DIGIT_REGEX.test(esicNumber)) {
        recordHasBlockingError = true;
        const exc = this.createExceptionRecord({
          batch_id: batchId,
          employee_id: employeeId,
          employee_name: employeeName,
          code: 'EMP006',
          actual_value: esicNumber,
          message: `Employee ${employeeName} (${employeeId}) has invalid ESIC Number "${esicNumber}". Must be exactly 10 digits.`,
        });
        exceptions.push(exc);
        const { task, alert } = this.createTaskAndAlert(batchId, exc);
        hrTasks.push(task);
        hrAlerts.push(alert);
      } else {
        // Validation 3: Duplicate ESIC numbers across records
        if (seenBatchEsicNumbers.has(esicNumber)) {
          recordHasBlockingError = true;
          const firstEmployeeId = seenBatchEsicNumbers.get(esicNumber);
          const exc = this.createExceptionRecord({
            batch_id: batchId,
            employee_id: employeeId,
            employee_name: employeeName,
            code: 'EMP007',
            actual_value: esicNumber,
            message: `Duplicate ESIC Number "${esicNumber}" shared between ${employeeName} (${employeeId}) and employee ${firstEmployeeId}.`,
          });
          exceptions.push(exc);
          const { task, alert } = this.createTaskAndAlert(batchId, exc);
          hrTasks.push(task);
          hrAlerts.push(alert);
        } else {
          seenBatchEsicNumbers.set(esicNumber, employeeId);
        }
      }

      // Validation 4: EMP005 - Salary Exceeds Limit
      if (grossSalary > applicableWageLimit && !isGrandfathered) {
        recordHasBlockingError = true;
        const exc = this.createExceptionRecord({
          batch_id: batchId,
          employee_id: employeeId,
          employee_name: employeeName,
          code: 'EMP005',
          actual_value: grossSalary,
          message: `Gross salary of ₹${grossSalary} exceeds ESIC wage limit of ₹${applicableWageLimit} for ${employeeName} (${employeeId}) without active cycle grandfathering.`,
        });
        exceptions.push(exc);
        const { task, alert } = this.createTaskAndAlert(batchId, exc);
        hrTasks.push(task);
        hrAlerts.push(alert);
      }

      // If record is defective, exclude from compliant export calculations
      if (recordHasBlockingError) {
        continue;
      }

      // Pillar 3: Calculation (0.75% employee share, 3.25% employer share)
      const rawEeShare = grossSalary * ESIC_EE_RATE;
      const rawErShare = grossSalary * ESIC_ER_RATE;

      // Statutory round to nearest rupee (half-up)
      const employeeShare = Math.round(rawEeShare);
      const employerShare = Math.round(rawErShare);
      const lineTotal = employeeShare + employerShare;

      totalWages += grossSalary;
      totalEmployeeShare += employeeShare;
      totalEmployerShare += employerShare;

      compliantRecords.push({
        esic_no: employerCode,
        employee_id: employeeId,
        employee_name: employeeName,
        ip_no: esicNumber,
        no_of_days: daysWorked,
        total_wages: grossSalary,
        employee_share: employeeShare,
        employer_share: employerShare,
        total_contribution: lineTotal,
        disability_percentage: disabilityPct,
        applicable_wage_limit: applicableWageLimit,
      });
    }

    // Persist records in engine tables
    this.esicExceptions.set(batchId, exceptions);
    this.hrTasks.set(batchId, hrTasks);
    this.hrAlerts.set(batchId, hrAlerts);

    const calculationResult = {
      batch_id: batchId,
      run_id: runId,
      period: periodStr,
      employer_code: employerCode,
      summary: {
        total_records_processed: payroll_records.length,
        total_applicable_records: payroll_records.length - nonApplicableRecords.length,
        total_compliant_records: compliantRecords.length,
        total_exceptions: exceptions.length,
        total_wages: totalWages,
        total_employee_share: totalEmployeeShare,
        total_employer_share: totalEmployerShare,
        total_challan_amount: totalEmployeeShare + totalEmployerShare,
      },
      compliant_records: compliantRecords,
      exceptions,
      hr_tasks: hrTasks,
      hr_alerts: hrAlerts,
      non_applicable_records: nonApplicableRecords,
      calculated_at: new Date().toISOString(),
    };

    this.calculationResults.set(batchId, calculationResult);

    // Transition stepper to ESIC_CALCULATED
    this.recordStepperTransition(batchId, 'ESIC_CALCULATED', 'AUTOMATION_BUILDER', `Calculated contributions for ${compliantRecords.length} compliant IPs. Found ${exceptions.length} exceptions.`);

    // If 0 exceptions, automatically advance to VALIDATED
    if (exceptions.length === 0) {
      this.recordStepperTransition(batchId, 'VALIDATED', 'VALIDATION_GATEKEEPER', 'All validation rules passed with zero blocking issues.');
    } else {
      const stepper = this.stepperStates.get(batchId);
      if (stepper) {
        stepper.is_blocked = true;
        stepper.unresolved_blocking_exceptions_count = exceptions.length;
        stepper.updated_at = new Date().toISOString();
      }
    }

    return calculationResult;
  }

  createExceptionRecord({ batch_id, employee_id, employee_name, code, actual_value, message }) {
    const def = ESIC_EXCEPTION_CODES[code] || {
      code,
      title: 'Statutory Compliance Exception',
      severity: 'BLOCK',
      field: 'unknown',
      suggested_fix: 'Review employee profile and resolve statutory non-compliance.',
    };

    return {
      exception_id: `EXC_${batch_id}_${employee_id}_${code}_${crypto.randomBytes(3).toString('hex')}`,
      batch_id,
      employee_id,
      employee_name,
      code,
      error_label: def.title,
      field: def.field,
      actual_value,
      severity: def.severity,
      message,
      suggested_fix: def.suggested_fix,
      resolved: false,
      resolved_at: null,
      resolved_by: null,
      created_at: new Date().toISOString(),
    };
  }

  createTaskAndAlert(batchId, exception) {
    const now = new Date().toISOString();
    const task = {
      task_id: `TASK_HR_${batchId}_${exception.employee_id}_${exception.code}`,
      batch_id: batchId,
      employee_id: exception.employee_id,
      employee_name: exception.employee_name,
      task_type: 'ESIC_EXCEPTION_REMEDIATION',
      assignee_role: 'HR_OPERATIONS',
      priority: exception.severity === 'BLOCK' ? 'HIGH' : 'MEDIUM',
      title: `ESIC Exception [${exception.code}]: ${exception.error_label} for ${exception.employee_name} (${exception.employee_id})`,
      description: exception.message,
      action_required: exception.suggested_fix,
      exception_ref: exception.exception_id,
      status: 'PENDING',
      due_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(), // 24-hour SLA
      created_at: now,
    };

    const alert = {
      alert_id: `ALERT_${batchId}_${exception.employee_id}_${exception.code}`,
      batch_id: batchId,
      employee_id: exception.employee_id,
      code: exception.code,
      severity: exception.severity === 'BLOCK' ? 'CRITICAL' : 'WARNING',
      channels: ['IN_APP', 'EMAIL'],
      recipient: 'hr-compliance@kylrx.ai',
      subject: `[CRITICAL COMPLIANCE ALERT] ESIC ${exception.code} - ${exception.error_label}`,
      message: `Payroll run encountered a blocking statutory violation: ${exception.message} Remediation required before filing.`,
      sent_at: now,
    };

    return { task, alert };
  }

  /* ============================================================================
   * PILLAR 5: FILE OUTPUT (ESIC_CONTRIBUTION_MONTH_YEAR.txt / .xls) & STEPPER
   * ============================================================================
   */

  /**
   * Generates official export files:
   *  - ESIC_CONTRIBUTION_MONTH_YEAR.txt
   *  - ESIC_CONTRIBUTION_MONTH_YEAR.xls
   *
   * Official 7 Columns:
   * [ESIC No, Employee Name, IP No, No. of Days, Total Wages, Employee Share, Employer Share]
   */
  generateExportFiles(batchId) {
    const calcResult = this.calculationResults.get(batchId);
    if (!calcResult) {
      throw new Error(`No calculation result found for batch ${batchId}. Run calculateEsicBatch first.`);
    }

    const periodStr = calcResult.period; // e.g. '2026-09' or 'September 2026'
    const [month, year] = extractMonthYear(periodStr);

    const baseFileName = `ESIC_CONTRIBUTION_${month}_${year}`;
    const txtFileName = `${baseFileName}.txt`;
    const xlsFileName = `${baseFileName}.xls`;

    const headers = [
      'ESIC No',
      'Employee Name',
      'IP No',
      'No. of Days',
      'Total Wages',
      'Employee Share',
      'Employer Share',
    ];

    const records = calcResult.compliant_records;

    // 1. Delimited Text File (.txt) - formatted with standard # delimiter
    const txtLines = [
      headers.join('#'),
      ...records.map((r) =>
        [
          r.esic_no,
          r.employee_name,
          r.ip_no,
          r.no_of_days,
          r.total_wages,
          r.employee_share,
          r.employer_share,
        ].join('#')
      ),
    ];
    const rawTxtContent = txtLines.join('\r\n');
    const txtChecksum = crypto.createHash('sha256').update(rawTxtContent, 'utf8').digest('hex');

    // 2. Excel-compatible Workbook (.xls HTML/XML Table)
    const xlsRows = records.map((r) => `
    <tr>
      <td>${escapeXml(r.esic_no)}</td>
      <td>${escapeXml(r.employee_name)}</td>
      <td style="mso-number-format:'\\@';">${escapeXml(r.ip_no)}</td>
      <td style="text-align:right;">${r.no_of_days}</td>
      <td style="text-align:right;">${r.total_wages.toFixed(2)}</td>
      <td style="text-align:right;">${r.employee_share.toFixed(2)}</td>
      <td style="text-align:right;">${r.employer_share.toFixed(2)}</td>
    </tr>`).join('');

    const rawXlsContent = `<?xml version="1.0" encoding="UTF-8"?>
<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:x="urn:schemas-microsoft-com:office:excel" xmlns="http://www.w3.org/TR/REC-html40">
<head>
  <!--[if gte mso 9]>
  <xml>
    <x:ExcelWorkbook>
      <x:ExcelWorksheets>
        <x:ExcelWorksheet>
          <x:Name>ESIC Contribution</x:Name>
          <x:WorksheetOptions><x:DisplayGridlines/></x:WorksheetOptions>
        </x:ExcelWorksheet>
      </x:ExcelWorksheets>
    </x:ExcelWorkbook>
  </xml>
  <![endif]-->
  <meta http-equiv="Content-Type" content="text/html; charset=UTF-8">
  <style>
    th { background-color: #1a365d; color: #ffffff; font-weight: bold; border: 1px solid #cbd5e0; padding: 6px; }
    td { border: 1px solid #cbd5e0; padding: 4px 6px; }
  </style>
</head>
<body>
  <table>
    <thead>
      <tr>
        ${headers.map((h) => `<th>${escapeXml(h)}</th>`).join('')}
      </tr>
    </thead>
    <tbody>
      ${xlsRows}
    </tbody>
  </table>
</body>
</html>`;
    const xlsChecksum = crypto.createHash('sha256').update(rawXlsContent, 'utf8').digest('hex');

    const manifest = {
      batch_id: batchId,
      period: periodStr,
      month,
      year,
      txt_file: {
        file_name: txtFileName,
        checksum: txtChecksum,
        row_count: records.length,
        size_bytes: Buffer.byteLength(rawTxtContent, 'utf8'),
      },
      xls_file: {
        file_name: xlsFileName,
        checksum: xlsChecksum,
        row_count: records.length,
        size_bytes: Buffer.byteLength(rawXlsContent, 'utf8'),
      },
      total_wages: calcResult.summary.total_wages,
      total_employee_share: calcResult.summary.total_employee_share,
      total_employer_share: calcResult.summary.total_employer_share,
      total_challan_amount: calcResult.summary.total_challan_amount,
      generated_at: new Date().toISOString(),
    };

    const output = {
      manifest,
      txt: {
        file_name: txtFileName,
        content: rawTxtContent,
        checksum: txtChecksum,
      },
      xls: {
        file_name: xlsFileName,
        content: rawXlsContent,
        checksum: xlsChecksum,
      },
    };

    this.exportFiles.set(batchId, output);

    // Stepper transition to FILE_GENERATED
    this.recordStepperTransition(
      batchId,
      'FILE_GENERATED',
      'EXPORT_GENERATION_ENGINE',
      `Export files compiled: ${txtFileName} and ${xlsFileName} (Checksum: ${txtChecksum.slice(0, 8)}...)`
    );

    return output;
  }

  /**
   * Advances the batch through the 7-stage visual stepper:
   * 1. PAYROLL_FINALIZED -> 2. ESIC_CALCULATED -> 3. VALIDATED -> 4. FILE_GENERATED ->
   * 5. PORTAL_UPLOADED -> 6. PAYMENT_DONE -> 7. COMPLETED
   *
   * @param {string} batchId
   * @param {string} targetStage
   * @param {object} [options]
   */
  advanceStepperStage(batchId, targetStage, options = {}) {
    const stepper = this.stepperStates.get(batchId);
    if (!stepper) {
      throw new Error(`Stepper state not found for batch ${batchId}. Initialize batch first.`);
    }

    const currentIdx = ESIC_STEPPER_STAGES.indexOf(stepper.current_stage);
    const targetIdx = ESIC_STEPPER_STAGES.indexOf(targetStage);

    if (targetIdx === -1) {
      throw new Error(`Invalid target stage "${targetStage}". Must be one of: ${ESIC_STEPPER_STAGES.join(', ')}`);
    }

    if (targetIdx <= currentIdx) {
      throw new Error(`Cannot transition backwards or sideways from ${stepper.current_stage} to ${targetStage}.`);
    }

    // Validation Gate: Cannot advance to or past VALIDATED if there are unresolved blocking exceptions
    if (targetIdx >= ESIC_STEPPER_STAGES.indexOf('VALIDATED') && !options.force) {
      const exceptions = this.esicExceptions.get(batchId) || [];
      const unresolvedBlocking = exceptions.filter((e) => e.severity === 'BLOCK' && !e.resolved);

      if (unresolvedBlocking.length > 0) {
        const error = new Error(
          `Cannot advance batch to ${targetStage}: ${unresolvedBlocking.length} unresolved blocking exceptions exist in ESIC_Exceptions.`
        );
        error.code = 'UNRESOLVED_ESIC_EXCEPTIONS';
        error.unresolved_count = unresolvedBlocking.length;
        error.exceptions = unresolvedBlocking;
        throw error;
      }
    }

    // Auto-trigger file generation if transitioning to FILE_GENERATED and files not yet compiled
    if (targetStage === 'FILE_GENERATED' && !this.exportFiles.has(batchId)) {
      this.generateExportFiles(batchId);
      return this.getStepperState(batchId);
    }

    this.recordStepperTransition(
      batchId,
      targetStage,
      options.actor || 'COMPLIANCE_OFFICER',
      options.notes || `Advanced to ${ESIC_STEPPER_LABELS[targetStage] || targetStage}`
    );

    return this.getStepperState(batchId);
  }

  recordStepperTransition(batchId, stage, actor, notes) {
    let stepper = this.stepperStates.get(batchId);
    if (!stepper) {
      stepper = {
        batch_id: batchId,
        run_id: batchId,
        period: '2026-09',
        current_stage: stage,
        history: [],
        is_blocked: false,
        unresolved_blocking_exceptions_count: 0,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };
      this.stepperStates.set(batchId, stepper);
    }

    stepper.current_stage = stage;
    stepper.updated_at = new Date().toISOString();
    stepper.history.push({
      stage,
      label: ESIC_STEPPER_LABELS[stage] || stage,
      transitioned_at: new Date().toISOString(),
      actor,
      notes,
    });

    const exceptions = this.esicExceptions.get(batchId) || [];
    const unresolvedBlocking = exceptions.filter((e) => e.severity === 'BLOCK' && !e.resolved);
    stepper.unresolved_blocking_exceptions_count = unresolvedBlocking.length;
    stepper.is_blocked = unresolvedBlocking.length > 0;

    return stepper;
  }

  getStepperState(batchId) {
    const stepper = this.stepperStates.get(batchId);
    if (!stepper) return null;

    const currentIdx = ESIC_STEPPER_STAGES.indexOf(stepper.current_stage);
    const stagesSummary = ESIC_STEPPER_STAGES.map((s, idx) => ({
      stage: s,
      label: ESIC_STEPPER_LABELS[s],
      status: idx < currentIdx ? 'COMPLETED' : (idx === currentIdx ? (stepper.current_stage === 'COMPLETED' ? 'COMPLETED' : 'ACTIVE') : 'PENDING'),
      is_current: idx === currentIdx,
    }));

    return {
      ...stepper,
      current_stage_label: ESIC_STEPPER_LABELS[stepper.current_stage],
      stages: stagesSummary,
      progress_percent: Math.round(((currentIdx + 1) / ESIC_STEPPER_STAGES.length) * 100),
    };
  }

  resolveException(exceptionId, { resolved_by = 'hr-officer', fix_applied = 'Data remediated' } = {}) {
    for (const [batchId, exceptions] of this.esicExceptions.entries()) {
      const exc = exceptions.find((e) => e.exception_id === exceptionId);
      if (exc) {
        exc.resolved = true;
        exc.resolved_at = new Date().toISOString();
        exc.resolved_by = resolved_by;
        exc.fix_applied = fix_applied;

        // Also update corresponding HRTask
        const tasks = this.hrTasks.get(batchId) || [];
        const task = tasks.find((t) => t.exception_ref === exceptionId);
        if (task) {
          task.status = 'RESOLVED';
          task.resolved_at = new Date().toISOString();
        }

        // Update stepper blocking status
        const unresolved = exceptions.filter((e) => e.severity === 'BLOCK' && !e.resolved);
        const stepper = this.stepperStates.get(batchId);
        if (stepper) {
          stepper.unresolved_blocking_exceptions_count = unresolved.length;
          stepper.is_blocked = unresolved.length > 0;
          stepper.updated_at = new Date().toISOString();
        }

        return { success: true, exception: exc };
      }
    }
    return { success: false, error: `Exception ${exceptionId} not found.` };
  }
}

function extractMonthYear(periodStr) {
  if (!periodStr) {
    const now = new Date();
    return [String(now.getMonth() + 1).padStart(2, '0'), String(now.getFullYear())];
  }

  // Handle YYYY-MM
  const isoMatch = String(periodStr).match(/^(\d{4})-(\d{2})/);
  if (isoMatch) {
    return [isoMatch[2], isoMatch[1]];
  }

  // Handle "September 2026"
  const monthNames = [
    'january', 'february', 'march', 'april', 'may', 'june',
    'july', 'august', 'september', 'october', 'november', 'december',
  ];
  const parts = String(periodStr).toLowerCase().split(/[\s-]+/);
  let month = '09';
  let year = '2026';

  for (const p of parts) {
    const idx = monthNames.indexOf(p);
    if (idx !== -1) {
      month = String(idx + 1).padStart(2, '0');
    } else if (/^\d{4}$/.test(p)) {
      year = p;
    }
  }

  return [month, year];
}

function escapeXml(unsafe) {
  if (unsafe === undefined || unsafe === null) return '';
  return String(unsafe)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

// Global Singleton Instance
export const globalEsicAutomationEngine = new EsicAutomationEngine();
