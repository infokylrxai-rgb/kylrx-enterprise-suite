/**
 * ============================================================================
 * KYLRX AI ENTERPRISE HRMS - GRATUITY STATUTORY POLICY & PROFILE SCHEMA
 * ============================================================================
 * Versioned, policy-driven Gratuity Configuration and Employee Master Models.
 * Eliminates all hardcoded statutory limits, multipliers, and formulas.
 *
 * @version 3.1.0
 * @author Kylrx AI Lead Systems Architect
 */

export type GratuityServiceRoundingRule =
  | 'ROUND_NEAREST_HALF_YEAR' // Standard Indian statutory rule (> 6 months rounds up to next full year)
  | 'EXACT_FRACTION'          // Pro-rata continuous fraction (e.g., 5.42 years)
  | 'COMPLETED_FULL_YEARS';   // Strict integer completed years (floor)

export type GratuityExitReason =
  | 'RESIGNATION'
  | 'RETIREMENT'
  | 'TERMINATION'
  | 'DEATH'
  | 'DISABILITY';

/**
 * Versioned Policy Configuration Entity for Gratuity.
 */
export interface EmployeeGratuityPolicyConfig {
  config_id: string;                          // Unique identifier, e.g. 'GRAT_POL_2018_V2'
  effective_from: string;                     // ISO Date YYYY-MM-DD (e.g. '2018-03-29')
  effective_to: string | null;                // ISO Date YYYY-MM-DD or null if open-ended
  min_vesting_days: number;                   // e.g. 1825 (5 years) or 1700 (4y 240d rule)
  days_per_year_factor: number;               // e.g. 15 days wages per completed year of service
  working_days_divisor: number;               // e.g. 26 working days in a month
  statutory_tax_free_cap: number;             // e.g. 2000000 (₹20 Lakhs) or 1000000 (₹10 Lakhs pre-2018)
  service_rounding_rule: GratuityServiceRoundingRule; // e.g. 'ROUND_NEAREST_HALF_YEAR'
  death_disability_bypass_vesting: boolean;   // true: waives 5-year vesting on death/disablement
  description?: string;
  version?: number;
  is_active?: boolean;
  monthly_provision_rate?: number;            // e.g. 0.0481 (4.81% of basic + DA)
  created_at?: string;
  updated_at?: string;
}

/**
 * Beneficiary / Nominee Distribution Entity.
 */
export interface GratuityNominee {
  nominee_name: string;
  relationship: string;
  share_percentage: number;                   // 0 to 100; total should sum to 100%
  date_of_birth?: string;
  guardian_name?: string;                     // Required if nominee is minor
}

/**
 * Employee Master Gratuity Profile Entity.
 */
export interface EmployeeGratuityProfile {
  employee_id: string;
  employee_name?: string;
  date_of_joining: string;                    // ISO Date YYYY-MM-DD
  date_of_exit: string | null;                // ISO Date YYYY-MM-DD or null if active
  exit_reason?: GratuityExitReason | null;    // 'RESIGNATION' | 'RETIREMENT' | 'TERMINATION' | 'DEATH' | 'DISABILITY'
  last_drawn_basic?: number;                  // Monthly Basic Salary
  last_drawn_da?: number;                     // Monthly Dearness Allowance
  last_drawn_salary: number;                  // Basic + DA combined salary basis
  gratuity_eligible?: boolean;                // Flag for continuous service >= 5 years or statutory bypass
  nominees?: GratuityNominee[];               // Array of nominated beneficiaries
  nominee_details?: Array<{                   // Nominee details array [name, relation, share %]
    name: string;
    relation: string;
    share_percentage: number;
  }>;
  department?: string;
  designation?: string;
  created_at?: string;
  updated_at?: string;
}

/**
 * Calculated Gratuity Settlement Result Entity.
 */
export interface GratuityCalculationResult {
  employee_id: string;
  date_of_joining: string;
  date_of_exit: string;
  exit_reason: GratuityExitReason;
  tenure_days: number;
  tenure_years_raw: number;
  tenure_years_statutory: number;
  is_vested: boolean;
  vesting_bypass_reason: string | null;
  last_drawn_wages: number;                   // basic + DA
  raw_gratuity_amount: number;                // (15 * (basic + DA) * tenure) / 26
  statutory_tax_free_amount: number;          // Min(raw, statutory_tax_free_cap)
  taxable_excess_amount: number;              // Max(0, raw - statutory_tax_free_cap)
  payable_gratuity_amount: number;            // If vested -> raw_gratuity_amount, else 0
  nominee_allocations: Array<{
    nominee_name: string;
    relationship: string;
    share_percentage: number;
    allocated_amount: number;
  }>;
  policy_config_id: string;
  policy_version?: number;
  calculation_timestamp: string;
  execution_trace?: GratuityExecutionTrace;
}

/**
 * Detailed Execution Trace capturing intermediate calculation variables.
 */
export interface GratuityExecutionTrace {
  config_id: string;
  policy_version?: number;
  salary_basis: number;                      // last_drawn_basic + last_drawn_da
  last_drawn_basic: number;
  last_drawn_da: number;
  continuous_service_days: number;
  completed_service_factor: number;          // statutory years
  service_rounding_rule_applied: GratuityServiceRoundingRule;
  days_per_year_factor: number;              // e.g. 15
  working_days_divisor: number;              // e.g. 26
  raw_formula_output: number;                // (SalaryBasis * Factor * CompletedService) / Divisor
  statutory_tax_free_cap: number;            // Applied cap
  is_vested: boolean;
  vesting_gate_details: {
    min_vesting_days: number;
    continuous_service_days: number;
    bypass_applied: boolean;
    bypass_reason: string | null;
  };
  tax_exempt_amount: number;
  taxable_amount: number;
  final_payable_amount: number;
  execution_timestamp: string;
}

/**
 * Gratuity Validation Issue Entity for Pre-Flight and Eligibility Gate exceptions.
 */
export interface GratuityValidationIssue {
  issue_id: string;
  batch_id: string;
  employee_id: string;
  employee_name?: string;
  code: 'GRAT_VAL_001' | string;
  sub_code?: string;
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
 * HR Alert Task for Gratuity Exceptions Queue.
 */
export interface GratuityHRTask {
  task_id: string;
  batch_id: string;
  employee_id: string;
  employee_name?: string;
  issue_code: 'GRAT_VAL_001' | string;
  priority: 'HIGH' | 'CRITICAL' | 'MEDIUM';
  title: string;
  message: string;
  suggested_action: string;
  status: 'PENDING_REVIEW' | 'IN_PROGRESS' | 'RESOLVED' | 'DISMISSED';
  created_at: string;
  assigned_role: string;
}

/**
 * Result of Gratuity Validation Pipeline Execution.
 */
export interface GratuityBatchValidationResult {
  batch_id: string;
  status: 'PASSED' | 'BLOCKED' | 'PARTIAL';
  is_blocked: boolean;
  can_disburse: boolean;
  total_records: number;
  valid_count: number;
  blocked_count: number;
  staged_settlements: GratuityCalculationResult[];
  validation_issues: GratuityValidationIssue[];
  blocking_issues: GratuityValidationIssue[];
  hr_tasks: GratuityHRTask[];
  validation_timestamp: string;
}

export type GratuityApprovalState =
  | 'DRAFT'
  | 'PENDING_GRATUITY_APPROVAL'
  | 'APPROVED'
  | 'REJECTED'
  | 'POSTED_TO_FNF';

/**
 * Persisted Gratuity Settlement Record with Maker-Checker Metadata.
 */
export interface GratuitySettlementRecord {
  settlement_id: string;
  batch_id: string;
  employee_id: string;
  employee_name: string;
  department?: string;
  designation?: string;
  settlement_details: GratuityCalculationResult;
  status: GratuityApprovalState;
  maker_id: string;
  maker_name?: string;
  maker_timestamp: string;
  checker_id: string | null;
  checker_name?: string | null;
  checker_timestamp: string | null;
  checker_notes?: string | null;
  fnf_batch_id?: string | null;
  ledger_entry_id?: string | null;
  created_at: string;
  updated_at: string;
}

/**
 * Corporate Gratuity Liability Ledger Entry (Journal Entry).
 */
export interface GratuityLiabilityLedgerEntry {
  ledger_id: string;
  settlement_id: string;
  employee_id: string;
  employee_name: string;
  transaction_type: 'GRATUITY_SETTLEMENT_RELEASE';
  amount: number;
  tax_exempt_amount: number;
  taxable_amount: number;
  debit_account: string;      // e.g. 'GL-2200 - Provision for Gratuity (Balance Sheet)'
  credit_account: string;     // e.g. 'GL-1100 - Bank / Payroll Clearing Account (F&F Disbursement)'
  excess_pnl_debit_account?: string; // e.g. 'GL-6100 - Gratuity Expense (P&L)'
  status: 'POSTED' | 'REVERSED';
  approved_by: string;
  posted_at: string;
}

/**
 * Final Settlement (F&F) Batch Entry for Gratuity.
 */
export interface GratuityFnFBatchEntry {
  fnf_entry_id: string;
  fnf_batch_id: string;
  settlement_id: string;
  employee_id: string;
  employee_name: string;
  disbursement_category: 'STATUTORY_GRATUITY';
  payable_amount: number;
  tax_exempt_amount: number;
  taxable_amount: number;
  status: 'QUEUED_FOR_DISBURSEMENT' | 'DISBURSED';
  queued_at: string;
  approved_by: string;
}

/**
 * 7-Stage Visual Compliance & Settlement Stepper Stages for Gratuity (Column 2 Blueprint).
 * Progression:
 * 1. Employee Exit / Payroll Finalized -> 2. Eligibility Check -> 3. Calculate Gratuity ->
 * 4. Generate Statement -> 5. HR Approval -> 6. Process Payment -> 7. Completed
 */
export type GratuityWorkflowStage =
  | 'TRIGGERED'
  | 'ELIGIBILITY_CHECK'
  | 'CALCULATE_GRATUITY'
  | 'GENERATE_STATEMENT'
  | 'HR_APPROVAL'
  | 'PROCESS_PAYMENT'
  | 'COMPLETED';

/**
 * Gratuity Statement Row matching official export layout:
 * [Employee ID, Employee Name, DOJ, Exit Date, Completed Years, Last Salary, Gratuity Amount]
 */
export interface GratuityStatementRow {
  employee_id: string;
  employee_name: string;
  doj: string;
  exit_date: string;
  completed_years: number;
  last_salary: number;
  gratuity_amount: number;
}

/**
 * Official Gratuity Statement Manifest for Gratuity_Statement_MONTH_YEAR.xlsx
 */
export interface GratuityStatementManifest {
  file_name: string;
  format: 'xlsx' | 'csv' | 'html';
  batch_id: string;
  period: string;
  total_records: number;
  total_gratuity_amount: number;
  checksum_sha256: string;
  generated_at: string;
}

/**
 * Gratuity Stepper State Machine Entity
 */
export interface GratuityStepperState {
  batch_id: string;
  trigger_source: 'EMPLOYEE_EXIT' | 'PAYROLL_FINALIZED' | 'MANUAL';
  current_stage: GratuityWorkflowStage;
  history: Array<{
    stage: GratuityWorkflowStage;
    transitioned_at: string;
    actor: string;
    notes?: string;
  }>;
  maker_id: string;
  checker_id: string | null;
  approved_at: string | null;
  is_approved: boolean;
  is_blocked: boolean;
  created_at: string;
  updated_at: string;
}

