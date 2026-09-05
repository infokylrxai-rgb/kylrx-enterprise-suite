/**
 * ============================================================================
 * KYLRX AI ENTERPRISE HRMS - ESIC STATUTORY POLICY & PROFILE SCHEMA
 * ============================================================================
 * Effective-Dated Statutory Configuration Engine Models for ESIC Compliance.
 * Eliminates all hardcoded statutory rates and wage ceilings.
 *
 * @version 3.1.0
 * @author Kylrx AI Lead Systems Architect
 */

export type ESICRoundingRule = 'NEAREST_RUPEE' | 'ROUND_UP' | 'ROUND_DOWN' | 'NO_ROUNDING';

/**
 * Effective-Dated ESIC Policy Configuration Entity.
 */
export interface ESIC_Policy_Config {
  config_id: string;
  effective_from: string; // ISO Date YYYY-MM-DD (e.g., '2019-07-01')
  effective_to: string | null; // ISO Date YYYY-MM-DD or null for open-ended active rule
  wage_ceiling_standard: number; // e.g., 21000
  wage_ceiling_disabled: number; // e.g., 25000 for employees with disabilities (Section 39)
  employee_rate: number; // e.g., 0.0075 (0.75%)
  employer_rate: number; // e.g., 0.0325 (3.25%)
  rounding_rule: ESICRoundingRule; // e.g., 'NEAREST_RUPEE'
  description?: string;
  version?: number;
  created_at?: string;
  created_by?: string;
  is_active?: boolean;
}

/**
 * Employee Master ESIC Profile Entity.
 */
export interface EmployeeESICProfile {
  employee_id: string;
  esic_number: string; // 10-digit statutory format (/^[0-9]{10}$/)
  esic_applicable: boolean; // Policy coverage flag
  date_of_joining: string; // ISO Date YYYY-MM-DD
  date_of_exit: string | null; // ISO Date YYYY-MM-DD or null if currently employed
  disability_flag: boolean; // True applies wage_ceiling_disabled (25k threshold)
  disability_percentage?: number; // Disability percentage (>= 40 qualifies for PwD wage ceiling)
  effective_from: string; // ISO Date YYYY-MM-DD
  effective_to: string | null; // ISO Date YYYY-MM-DD or null
  dispensary_code?: string;
  branch_office?: string;
  nominee_name?: string;
  nominee_relationship?: string;
  created_at?: string;
  updated_at?: string;
}

/**
 * Raw Ingested CSV/Excel Row for Bulk ESIC Upload.
 */
export interface ESICUploadRow {
  employee_id: string;
  esic_number: string;
  esic_applicable: string | boolean;
  date_of_joining: string;
  date_of_exit: string | null;
  disability_flag?: string | boolean;
  disability_percentage?: string | number;
  effective_from?: string;
  effective_to?: string | null;
}

/**
 * ESIC Ingestion Exception Entity for Invalid Records.
 */
export interface ESICUploadException {
  exception_id: string;
  batch_id: string;
  row_number: number;
  employee_id: string;
  field: string;
  code:
    | 'ERR_MISSING_EMPLOYEE_ID'
    | 'ERR_MALFORMED_ESIC_NUMBER'
    | 'ERR_DUPLICATE_ESIC_NUMBER_BATCH'
    | 'ERR_DUPLICATE_ESIC_NUMBER_EXISTING'
    | 'ERR_INVALID_APPLICABLE_FLAG'
    | 'ERR_INVALID_DISABILITY_FLAG'
    | 'ERR_INVALID_DATE_FORMAT'
    | 'ERR_INVERTED_EFFECTIVE_DATES'
    | 'ERR_INVERTED_EMPLOYMENT_DATES';
  message: string;
  raw_data: Record<string, any>;
  created_at: string;
}

/**
 * Result of Bulk ESIC Master Data Ingestion Pipeline.
 */
export interface ESICBulkIngestionResult {
  batch_id: string;
  total_rows: number;
  valid_rows_count: number;
  exception_rows_count: number;
  staged_records: EmployeeESICProfile[];
  exceptions: ESICUploadException[];
  status: 'SUCCESS' | 'PARTIAL_SUCCESS' | 'FAILED';
  processed_at: string;
}

/**
 * Detailed Result of ESIC Calculation for a specific employee & period.
 */
export interface ESIC_Calculation_Result {
  employee_id: string;
  period_date: string;
  gross_wages: number;
  is_covered: boolean;
  exemption_reason?: string | null;
  applicable_wage_ceiling: number;
  is_disabled_scheme: boolean;
  employee_rate_applied: number;
  employer_rate_applied: number;
  employee_contribution: number;
  employer_contribution: number;
  total_contribution: number;
  rounding_rule_applied: ESICRoundingRule;
  policy_config_id: string;
  policy_version?: number;
  calculation_timestamp: string;
}

/**
 * Aggregated ESIC Return & Challan Batch Result.
 */
export interface ESIC_Batch_Calculation_Result {
  payroll_period: string;
  policy_used: ESIC_Policy_Config;
  total_headcount: number;
  total_covered_employees: number;
  total_exempt_employees: number;
  total_statutory_wages: number;
  total_employee_deductions: number;
  total_employer_contributions: number;
  total_challan_amount: number;
  employee_breakdowns: ESIC_Calculation_Result[];
}

/**
 * Versioned Mapping Schema for ESIC Portal Return Layout.
 */
export interface ESICPortalTemplateMapping {
  layout_version: string; // e.g., 'ESIC_PORTAL_LAYOUT_V1_0'
  columns: Array<{
    field_key: string;
    header_name: string;
    description: string;
    required: boolean;
    format?: string;
  }>;
}

/**
 * Normalized Input Item for ESIC Return Generation.
 */
export interface ESICReturnRecordInput {
  employee_id?: string;
  esic_number: string; // 10-digit IP number
  employee_name: string; // IP Name
  days_worked?: number; // No. of days worked (0-31)
  gross_wages: number; // Total monthly wages
  employee_deduction?: number; // Calculated EE share
  employer_contribution?: number; // Calculated ER share
  zero_days_reason_code?: string; // Reason code if days worked is 0 (e.g., '1', '2', '3')
  last_working_day?: string; // DD/MM/YYYY or YYYY-MM-DD (or empty)
  disability_flag?: boolean;
}

/**
 * Generated Compliance Return Entity for ESIC Portal Filing.
 */
export interface ESICComplianceReturn {
  return_id: string;
  scheme: 'ESIC';
  period: string; // e.g. 'September 2026' or '2026-09'
  file_name: string;
  checksum: string; // SHA-256 hex digest
  row_count: number;
  total_employee_share: number;
  total_employer_share: number;
  total_challan_amount: number;
  source_payroll_run_id: string;
  policy_version_applied: string | number;
  layout_version: string;
  status: 'DRAFT' | 'GENERATED' | 'PENDING_SUBMISSION' | 'SUBMITTED' | 'ACCEPTED' | 'REJECTED';
  created_at: string;
  created_by: string;
}

/**
 * Audit Log Record for ESIC Return & Challan Generation.
 */
export interface ESICComplianceAuditLog {
  log_id: string;
  admin_id: string;
  action: 'ESIC_RETURN_GENERATED' | 'ESIC_CHALLAN_GENERATED' | 'ESIC_SUBMISSION_ATTEMPT';
  scheme: 'ESIC';
  period: string;
  source_payroll_run_id: string;
  input_calculation_parameters: {
    employer_code: string;
    wage_month: string;
    policy_version_applied: string | number;
    total_candidates: number;
    total_eligible_wages: number;
    [key: string]: any;
  };
  submission_status: 'GENERATED' | 'PENDING_SUBMISSION' | 'SUBMITTED' | 'FAILED';
  raw_output_file_metadata: {
    file_name: string;
    checksum: string;
    file_size_bytes: number;
    row_count: number;
    total_employee_share: number;
    total_employer_share: number;
    total_challan_amount: number;
  };
  timestamp: string;
}

/**
 * Visual Compliance Stepper Stages for ESIC Lifecycle (Column 1 Blueprint).
 * Sequential Progression:
 * 1. Payroll Finalized -> 2. ESIC Calculated -> 3. Validated -> 4. File/Challan Generated ->
 * 5. Uploaded to ESIC Portal -> 6. Payment Done -> 7. Compliance Completed
 */
export type EsicStepperStage =
  | 'PAYROLL_FINALIZED'
  | 'ESIC_CALCULATED'
  | 'VALIDATED'
  | 'FILE_GENERATED'
  | 'PORTAL_UPLOADED'
  | 'PAYMENT_DONE'
  | 'COMPLETED';

/**
 * Standard Exception Codes for ESIC Compliance Engine.
 */
export type EsicExceptionCode =
  | 'EMP004' // ESIC Number Missing
  | 'EMP005' // Salary Exceeds Limit
  | 'EMP006' // Invalid ESIC Number
  | 'EMP007' // Duplicate ESIC Number
  | 'ERR_MALFORMED_RECORD';

/**
 * ESIC Exception Record persisted in the ESIC_Exceptions table.
 */
export interface ESIC_ExceptionRecord {
  exception_id: string;
  batch_id: string;
  employee_id: string;
  employee_name?: string;
  code: EsicExceptionCode;
  error_label: string;
  field: string;
  actual_value: any;
  severity: 'BLOCK' | 'WARNING';
  message: string;
  suggested_fix: string;
  resolved: boolean;
  resolved_at: string | null;
  resolved_by: string | null;
  created_at: string;
}

/**
 * HR Remediation Task created upon detecting ESIC compliance exceptions.
 */
export interface HRTaskRecord {
  task_id: string;
  batch_id: string;
  employee_id: string;
  task_type: 'ESIC_EXCEPTION_REMEDIATION';
  assignee_role: 'HR_COMPLIANCE_OFFICER' | 'HR_OPERATIONS';
  priority: 'CRITICAL' | 'HIGH' | 'MEDIUM';
  title: string;
  description: string;
  action_required: string;
  exception_ref: string;
  status: 'PENDING' | 'IN_PROGRESS' | 'RESOLVED' | 'DISMISSED';
  due_at: string;
  created_at: string;
}

/**
 * HR Compliance Alert dispatched across multiple channels.
 */
export interface HRAlertRecord {
  alert_id: string;
  batch_id: string;
  employee_id: string;
  code: EsicExceptionCode;
  severity: 'CRITICAL' | 'WARNING';
  channels: Array<'IN_APP' | 'EMAIL' | 'WEBHOOK'>;
  recipient: string;
  subject: string;
  message: string;
  sent_at: string;
}

/**
 * Official ESIC 7-Column Export Record.
 * Layout: [ESIC No, Employee Name, IP No, No. of Days, Total Wages, Employee Share, Employer Share]
 */
export interface ESIC_ExportRow {
  esic_no: string; // Employer ESIC Code / Establishment Code (or IP No)
  employee_name: string;
  ip_no: string; // 10-digit Employee IP number
  no_of_days: number;
  total_wages: number;
  employee_share: number; // 0.75%
  employer_share: number; // 3.25%
}

/**
 * Official Export Manifest for ESIC Contribution Files.
 */
export interface ESIC_ExportManifest {
  file_name: string;
  format: 'txt' | 'xls';
  batch_id: string;
  period: string;
  row_count: number;
  total_wages: number;
  total_employee_share: number;
  total_employer_share: number;
  total_challan_amount: number;
  checksum_sha256: string;
  raw_content: string;
  generated_at: string;
}

/**
 * State and History for a Batch on the 7-stage Visual Compliance Stepper.
 */
export interface ESIC_StepperState {
  batch_id: string;
  run_id: string;
  period: string;
  current_stage: EsicStepperStage;
  history: Array<{
    stage: EsicStepperStage;
    transitioned_at: string;
    actor: string;
    notes?: string;
  }>;
  is_blocked: boolean;
  unresolved_blocking_exceptions_count: number;
  created_at: string;
  updated_at: string;
}

