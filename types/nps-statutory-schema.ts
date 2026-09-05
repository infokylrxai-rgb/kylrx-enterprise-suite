/**
 * ============================================================================
 * KYLRX AI ENTERPRISE HRMS - CORPORATE NPS STATUTORY POLICY & PROFILE SCHEMA
 * ============================================================================
 * Versioned, policy-driven configuration engine models for Corporate NPS
 * (National Pension System - PFRDA & NSDL CRA).
 * Eliminates all hardcoded contribution rates, salary bases, and tax caps.
 *
 * @version 3.1.0
 * @author Kylrx AI Principal Systems Architect
 */

export type NPSTierType = 'TIER_1' | 'TIER_2';

export type NPSContributionType =
  | 'EMPLOYER_ONLY'  // Employer co-contribution only (Section 80CCD(2))
  | 'EMPLOYEE_ONLY'  // Employee payroll deduction only (Section 80CCD(1) / 80CCD(1B))
  | 'BOTH';          // Both Employer & Employee co-contributions

export type NPSRoundingRule =
  | 'NEAREST_RUPEE'
  | 'ROUND_UP'
  | 'ROUND_DOWN'
  | 'NO_ROUNDING';

/**
 * Versioned Policy Configuration Entity for Corporate NPS.
 */
export interface NPS_Policy_Config {
  config_id: string;                     // e.g., 'NPS_CORP_2024_TIER1'
  plan_name: string;                     // e.g., 'Corporate NPS Tier 1 Standard'
  effective_from: string;                // ISO Date YYYY-MM-DD
  effective_to: string | null;           // ISO Date YYYY-MM-DD or null if open-ended
  tier_type: NPSTierType;                // 'TIER_1' | 'TIER_2'
  employer_rate_percentage: number;      // e.g., 10 (10% of Basic+DA under 80CCD(2)) or 14 (Govt/PSU)
  employee_default_rate: number;         // e.g., 10 (10% of Basic+DA)
  allow_voluntary_excess: boolean;       // Allows voluntary contribution on top of standard rate
  annual_sec80ccd1b_cap: number;         // e.g., 50000 (₹50,000 additional deduction under 80CCD(1B))
  salary_basis_components: string[];     // Array of wage components, e.g., ['BASIC', 'DA']
  rounding_rule: NPSRoundingRule;        // 'NEAREST_RUPEE' | 'ROUND_UP' | 'ROUND_DOWN' | 'NO_ROUNDING'
  description?: string;
  version?: number;
  is_active?: boolean;
  created_at?: string;
  updated_at?: string;
}

/**
 * Employee Master NPS Profile Entity.
 */
export interface EmployeeNPSProfile {
  employee_id: string;
  employee_name?: string;
  pran: string;                          // 12-digit Permanent Retirement Account Number (/^[0-9]{12}$/)
  nps_applicable: boolean;               // Opted-in flag for corporate scheme
  tier: NPSTierType | 'Tier I' | 'Tier II'; // 'TIER_1' | 'TIER_2' | 'Tier I' | 'Tier II'
  joining_date?: string;                 // ISO Date YYYY-MM-DD
  date_of_joining?: string;              // ISO Date YYYY-MM-DD (Column 3 Blueprint alias)
  exit_date: string | null;              // ISO Date YYYY-MM-DD or null if currently active
  contribution_type: NPSContributionType | 'Employee' | 'Employer' | 'Both'; // 'EMPLOYER_ONLY' | 'EMPLOYEE_ONLY' | 'BOTH'
  voluntary_monthly_amount?: number;     // Fixed voluntary contribution amount in INR (>= 0)
  effective_from?: string;               // ISO Date YYYY-MM-DD
  effective_to?: string | null;          // ISO Date YYYY-MM-DD or null
  employee_custom_rate?: number;         // Optional custom rate override (e.g. 12%)
  cra_subscriber_type?: string;          // e.g. 'CORPORATE' | 'GOVERNMENT' | 'ALL_CITIZEN'
  department?: string;
  designation?: string;
  created_at?: string;
  updated_at?: string;
}

/**
 * Detailed Calculation Result for an Employee's Monthly NPS Contribution.
 */
export interface NPSCalculationResult {
  employee_id: string;
  pran: string;
  period: string;                        // e.g. '2026-09' or 'September 2026'
  tier: NPSTierType;
  contribution_type: NPSContributionType;
  salary_basis: number;                  // Sum of components (Basic + DA)
  salary_basis_components_used: string[];
  employer_rate_percentage: number;
  employer_contribution: number;         // 80CCD(2)
  employee_rate_percentage: number;
  employee_mandatory_deduction: number;  // 80CCD(1)
  employee_voluntary_contribution: number; // 80CCD(1B) / Voluntary
  total_employee_contribution: number;   // Mandatory + Voluntary
  total_nps_contribution: number;        // Employer + Employee total
  sec80ccd1b_applicable_amount: number;  // Portion designated for 80CCD(1B) up to cap
  rounding_rule_applied: NPSRoundingRule;
  policy_config_id: string;
  policy_version?: number;
  calculation_timestamp: string;
  capped_reason?: string | null;
}

/**
 * NPS Validation Issue Entity for Pre-Disbursement defects.
 */
export interface NPSValidationIssue {
  issue_id: string;
  run_id: string;
  employee_id: string;
  employee_name?: string;
  code: 'STAT_NPS_INVALID_PRAN' | 'NPS_VAL_001' | 'EMP040' | string;
  sub_code: string;
  title: string;
  severity: 'BLOCK' | 'WARN';
  field: string | null;
  actual_value?: any;
  message: string;
  suggested_fix: string;
  resolved: boolean;
  resolved_at: string | null;
  resolved_by: string | null;
  created_at: string;
}

/**
 * HR Alert Task for NPS exceptions.
 */
export interface NPSHRTask {
  task_id: string;
  run_id: string;
  employee_id: string;
  employee_name?: string;
  issue_code: string;
  priority: 'HIGH' | 'CRITICAL' | 'MEDIUM';
  title: string;
  message: string;
  suggested_action: string;
  status: 'PENDING_REVIEW' | 'IN_PROGRESS' | 'RESOLVED';
  created_at: string;
  assigned_role: string;
}

/**
 * Aggregated Output of Payroll-Triggered NPS Calculation Batch.
 */
export interface NPSBatchCalculationResult {
  run_id: string;
  period: string;
  policy_id: string;
  total_candidates: number;
  eligible_count: number;
  blocked_count: number;
  compliant_records: NPSCalculationResult[];
  validation_issues: NPSValidationIssue[];
  hr_tasks: NPSHRTask[];
  total_employer_contributions: number;
  total_employee_deductions: number;
  total_nps_liability: number;
  total_salary_basis: number;
  processed_at: string;
}

/**
 * NPS Staged Candidate Record for Batch Staging Validation.
 */
export interface NPSStagedRecord {
  employee_id: string;
  employee_name?: string;
  pran: string;
  tier: NPSTierType;
  contribution_type: NPSContributionType;
  salary_basis?: number;
  basic?: number;
  da?: number;
  employer_contribution?: number;
  employee_mandatory_deduction?: number;
  voluntary_monthly_amount?: number;
  total_employee_contribution?: number;
  total_contribution?: number;
  net_salary?: number;
  gross_earnings?: number;
  joining_date?: string;
  exit_date?: string | null;
  nps_applicable?: boolean;
}

/**
 * Result of the NPS Batch Staging Validation Pipeline.
 */
export interface NPSBatchStagingValidationResult {
  batch_id: string;
  run_id: string;
  period: string;
  status: 'PASSED' | 'PARTIAL' | 'BLOCKED';
  is_blocked: boolean;
  can_export_file: boolean;
  total_staged: number;
  clean_count: number;
  blocked_count: number;
  clean_records: NPSCalculationResult[] | any[];
  blocked_records: Array<{
    record: any;
    issues: NPSValidationIssue[];
  }>;
  validation_issues: NPSValidationIssue[];
  blocking_issues: NPSValidationIssue[];
  hr_tasks: NPSHRTask[];
  total_employer_share: number;
  total_employee_share: number;
  total_nps_liability: number;
  validation_timestamp: string;
}

/**
 * NPS Compliance Return Entity persisted for PFRDA / NSDL CRA submission.
 */
export interface NPSComplianceReturn {
  return_id: string;
  scheme: 'NPS';
  period: string;
  month_year: string;
  corporate_registration_number: string;
  pao_pop_sp_code: string;
  file_name: string;
  file_ref_no: string;
  checksum_sha256: string;
  row_count: number;
  total_subscribers: number;
  total_employee_share: number;
  total_employer_share: number;
  total_amount: number;
  source_payroll_run_id: string;
  status: 'GENERATED' | 'UPLOADED' | 'ACKNOWLEDGED' | 'FAILED';
  executing_admin: string;
  created_at: string;
}

/**
 * Downloadable File Asset & Output metadata for NSDL CRA SCF.
 */
export interface NPSSCFFileResult {
  file_type: 'NSDL_CRA_SCF_TXT';
  file_name: string;
  mime_type: 'text/plain';
  file_size_bytes: number;
  content: string;
  checksum_sha256: string;
  compliance_return: NPSComplianceReturn;
  summary: {
    corporate_registration_number: string;
    pao_code: string;
    month_year: string;
    total_lines: number;
    total_subscribers: number;
    total_employee_contribution: number;
    total_employer_contribution: number;
    total_nps_remittance: number;
  };
}

/**
 * NPS Batch FSM Lifecycle States.
 */
export type NPSBatchLifecycleState =
  | 'FILE_GENERATED'
  | 'SUBMITTED'
  | 'ACK_RECEIVED'
  | 'COMPLETED'
  | 'REJECTED'
  | 'FAILED';

/**
 * NPS Batch FSM Transition Events.
 */
export type NPSBatchLifecycleEvent =
  | 'SUBMIT_TO_CRA'
  | 'INGEST_ACKNOWLEDGEMENT'
  | 'CONFIRM_SETTLEMENT'
  | 'REJECT_SUBMISSION'
  | 'REOPEN_FOR_RETRY';

/**
 * Transition history audit item.
 */
export interface NPSBatchTransitionHistoryEntry {
  transition_id: string;
  from_state: NPSBatchLifecycleState;
  to_state: NPSBatchLifecycleState;
  event: NPSBatchLifecycleEvent | string;
  actor_id: string;
  actor_role: string;
  timestamp: string;
  metadata?: Record<string, any>;
}

/**
 * Parsed CRA / NSDL Response Acknowledgement Receipt.
 */
export interface NPSAcknowledgementReceipt {
  receipt_id: string;
  prn: string;                          // Provisional Receipt Number (e.g. 'PRN202609040001')
  transaction_id: string;                // Banking / Gateway Transaction Reference
  processed_date: string;                // ISO Date YYYY-MM-DD
  clearing_status: 'SUCCESS' | 'CLEARED' | 'ACKNOWLEDGED' | 'REJECTED' | 'PARTIAL';
  total_subscribers_acknowledged: number;
  total_amount_cleared: number;
  raw_payload?: string | Record<string, any>;
  subscriber_acknowledgements: Array<{
    pran: string;
    employee_id?: string;
    status: 'ACKNOWLEDGED' | 'REJECTED' | 'FAILED';
    rejection_reason?: string | null;
  }>;
}

/**
 * Complete NPS Submission Batch Entity.
 */
export interface NPSSubmissionBatch {
  batch_id: string;
  run_id: string;
  period: string;
  state: NPSBatchLifecycleState;
  file_name: string;
  checksum_sha256: string;
  total_subscribers: number;
  total_amount: number;
  prn?: string | null;
  transaction_id?: string | null;
  processed_date?: string | null;
  clearing_status?: string | null;
  raw_gateway_error?: any | null;
  rejection_reason?: string | null;
  subscriber_records: Array<{
    pran: string;
    employee_id: string;
    employee_name?: string;
    total_contribution: number;
    status: 'STAGED' | 'SUBMITTED' | 'ACKNOWLEDGED' | 'REJECTED' | 'FAILED';
    flagged_for_correction?: boolean;
    rejection_reason?: string | null;
  }>;
  transition_history: NPSBatchTransitionHistoryEntry[];
  created_at: string;
  updated_at: string;
}

/**
 * 7-Stage Visual Lifecycle Stepper Stages for Corporate NPS (Column 3 Blueprint).
 * Progression:
 * 1. Payroll Finalized -> 2. NPS Calculated -> 3. Validated -> 4. File Generated ->
 * 5. Uploaded to NSDL -> 6. Acknowledgement -> 7. Completed
 */
export type NpsStepperStage =
  | 'PAYROLL_FINALIZED'
  | 'NPS_CALCULATED'
  | 'VALIDATED'
  | 'FILE_GENERATED'
  | 'UPLOADED_TO_NSDL'
  | 'ACKNOWLEDGEMENT'
  | 'COMPLETED';

/**
 * Official NSDL Upload Row Layout for NPS_Contribution_MONTH_YEAR.txt:
 * [PRAN, Employee Name, Employee Amt, Employer Amt, Total Amount]
 */
export interface NpsExportRow {
  pran: string; // 12-digit PRAN
  employee_name: string;
  employee_amt: number; // 10% Basic + DA under Sec 80CCD(1) + 80CCD(1B)
  employer_amt: number; // 10% Basic + DA under Sec 80CCD(2)
  total_amount: number; // Employee Amt + Employer Amt
}

/**
 * Official Export Manifest for NPS Contribution File
 */
export interface NpsExportManifest {
  file_name: string;
  batch_id: string;
  period: string;
  total_subscribers: number;
  total_employee_amount: number;
  total_employer_amount: number;
  total_contribution_amount: number;
  checksum_sha256: string;
  generated_at: string;
}

/**
 * Corporate NPS Lifecycle Stepper State
 */
export interface NpsStepperState {
  batch_id: string;
  run_id: string;
  period: string;
  current_stage: NpsStepperStage;
  history: Array<{
    stage: NpsStepperStage;
    transitioned_at: string;
    actor: string;
    notes?: string;
  }>;
  prn_acknowledgement_token?: string | null;
  is_blocked: boolean;
  unresolved_blocking_defects_count: number;
  created_at: string;
  updated_at: string;
}



