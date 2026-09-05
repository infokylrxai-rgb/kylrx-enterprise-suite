/**
 * ============================================================================
 * KYLRX AI ENTERPRISE HRMS - PAYROLL DISBURSEMENT & STATUTORY COMPLIANCE SCHEMA
 * ============================================================================
 * Architecture Layer: Domain Model, State Machines, Temporal Policy Engine,
 *                     Maker-Checker Workflows, Firestore Subcollections & Audit Trails.
 *
 * @version 2.4.0
 * @author Kylrx AI Lead Backend Architecture Team
 */

// Core schema definitions without external runtime dependencies
export interface Timestamp {
  seconds: number;
  nanoseconds: number;
  toDate?(): Date;
  toMillis?(): number;
}

/* ============================================================================
 * 1. ENUMS & FINITE STATE MACHINES (STRICT SEPARATION OF CONCERNS)
 * ============================================================================
 */

/**
 * Lifecycle state of the overall Monthly Payroll Computation.
 * Independent of disbursement or compliance filing status.
 */
export enum PayrollRunStatus {
  DRAFT = 'DRAFT',                       // Initial raw inputs / attendance sync
  CALCULATING = 'CALCULATING',           // Background worker computing gross/net/statutory
  CALCULATED = 'CALCULATED',             // Calculation complete, pending review
  UNDER_REVIEW = 'UNDER_REVIEW',         // HR / Finance team reviewing variance
  APPROVED = 'APPROVED',                 // Approved by Payroll Head; frozen for disbursement
  LOCKED = 'LOCKED',                     // Finalized period; no further salary edits permitted
  ARCHIVED = 'ARCHIVED',                 // Historical audit record
}

/**
 * Lifecycle state of an individual Payment Batch (NEFT / RTGS / NACH / Vendor Pay).
 * Decoupled from Payroll Run to allow split disbursements (e.g. Executives vs Staff).
 */
export enum PaymentBatchStatus {
  DRAFT = 'DRAFT',                       // Batch initialized with selected records
  VALIDATING = 'VALIDATING',             // 8-Point automated validation gate executing
  VALIDATION_FAILED = 'VALIDATION_FAILED', // Structural or regulatory errors detected
  VALIDATED = 'VALIDATED',               // 100% clean; ready for maker submission
  MAKER_SUBMITTED = 'MAKER_SUBMITTED',   // Submitted by Maker; awaiting Checker approval
  CHECKER_APPROVED = 'CHECKER_APPROVED', // 4-Eye rule satisfied; locked for export
  CHECKER_REJECTED = 'CHECKER_REJECTED', // Returned to Maker with rejection notes
  BANK_FILE_GENERATED = 'BANK_FILE_GENERATED', // Encrypted CSV/TXT created and logged
  TRANSMITTED = 'TRANSMITTED',           // Uploaded to Banking API (e.g., HDFC/ICICI Corporate)
  PROCESSING = 'PROCESSING',             // Clearing house processing settlement
  SETTLED = 'SETTLED',                   // 100% successful credits reconciled
  PARTIALLY_SETTLED = 'PARTIALLY_SETTLED', // Mixture of Success & Returns/Bounces
  FAILED = 'FAILED',                     // Batch level technical failure / rejected by bank
}

/**
 * Lifecycle state of Statutory Compliance Filings (PF ECR, ESIC Monthly, Gratuity, NPS SCF).
 */
export enum ComplianceFilingStatus {
  PENDING = 'PENDING',                   // Awaiting end of payroll run lock
  DATA_EXTRACTED = 'DATA_EXTRACTED',     // Wages & contributions aggregated
  EXCEPTIONS_FLAGGED = 'EXCEPTIONS_FLAGGED', // Missing UAN/IP/PRAN or format violations
  VALIDATED = 'VALIDATED',               // All statutory gates cleared
  FILE_GENERATED = 'FILE_GENERATED',     // Official upload format generated (.txt / .csv)
  UPLOADED_TO_PORTAL = 'UPLOADED_TO_PORTAL', // Filed on Unified Portal / ESIC / CRA
  CHALLAN_GENERATED = 'CHALLAN_GENERATED', // TRRN / Challan reference generated
  PAID_AND_RECONCILED = 'PAID_AND_RECONCILED', // Payment confirmed against bank UTR
}

/**
 * Statutory Compliance Heads managed under Indian Labor Regulations.
 */
export enum StatutoryHead {
  PF = 'PF',                             // Employees' Provident Fund & MP Act, 1952
  ESIC = 'ESIC',                         // Employees' State Insurance Act, 1948
  GRATUITY = 'GRATUITY',                 // Payment of Gratuity Act, 1972
  NPS = 'NPS',                           // National Pension System (PFRDA)
  PROFESSIONAL_TAX = 'PT',               // State-wise Professional Tax Acts
  LABOUR_WELFARE_FUND = 'LWF',           // State Labour Welfare Fund Acts
  TDS = 'TDS',                           // Income Tax Act, 1961 (Section 192)
}

/**
 * Payment rail used for bank file generation.
 */
export enum PaymentRail {
  NEFT = 'NEFT',
  RTGS = 'RTGS',
  IMPS = 'IMPS',
  NACH = 'NACH',
  INTERNAL_TRANSFER = 'INTERNAL_TRANSFER', // Intra-bank direct transfer (e.g., HDFC to HDFC)
}

export enum ValidationSeverity {
  CRITICAL = 'CRITICAL',                 // Blocks batch submission & file generation
  WARNING = 'WARNING',                   // Flagged for maker review; can be overridden by checker
  INFO = 'INFO',                         // Informational telemetry
}

export enum BankTransactionStatus {
  PENDING = 'PENDING',
  SUCCESS = 'SUCCESS',
  PAID = 'PAID',                         // Explicitly confirmed by bank (Anti-Assumption Guard gate)
  FAILED = 'FAILED',
  RETURNED = 'RETURNED',
  REVERSED = 'REVERSED',
  EXCEPTION = 'EXCEPTION',               // Held in exception queue; not cleared
  PARTIAL = 'PARTIAL',                   // Partially settled; supplementary instruction required
}

/**
 * Reconciliation exception types raised by the 6-guard interceptor.
 * Mirrors ReconciliationExceptionType in reconciliation-schema.ts;
 * duplicated here so payroll domain types remain self-contained.
 */
export enum ReconciliationExceptionType {
  AMOUNT_MISMATCH        = 'AMOUNT_MISMATCH',
  MISSING_IDENTIFIER     = 'MISSING_IDENTIFIER',
  ORPHANED_ROW           = 'ORPHANED_ROW',
  DUPLICATE_EXTERNAL_REF = 'DUPLICATE_EXTERNAL_REF',
  PARTIAL_SETTLEMENT     = 'PARTIAL_SETTLEMENT',
}

/** Lifecycle state of an exception queue entry. */
export type ExceptionQueueStatus = 'OPEN' | 'IN_REVIEW' | 'RESOLVED' | 'WAIVED';


/* ============================================================================
 * 2. TEMPORAL STATUTORY POLICY METADATA (CONFIGURABLE VERSIONING ENGINE)
 * ============================================================================
 */

/**
 * Represents temporal regulatory ceilings, rates, and deduction rules.
 * Versioned with effective_from and effective_to to allow retro computations.
 */
export interface StatutoryPolicyConfig {
  policy_id: string;
  head: StatutoryHead;
  jurisdiction: string;                  // 'CENTRAL' or State Code ('KA', 'MH', 'DL')
  version: number;
  effective_from: Timestamp | string;
  effective_to: Timestamp | string | null; // null = currently active

  rules: {
    // PF Specific Rules
    pf_wage_ceiling?: number;            // Default ₹15,000
    pf_employee_rate?: number;           // 0.12 (12%)
    pf_employer_epf_rate?: number;       // 0.0367 (3.67%)
    pf_employer_eps_rate?: number;       // 0.0833 (8.33% capped at ₹1,250)
    pf_eps_wage_ceiling?: number;        // ₹15,000
    pf_edli_rate?: number;               // 0.005 (0.50% capped at ₹75/mo)
    pf_admin_charge_rate?: number;       // 0.005 (0.50% min ₹500/establishment)

    // ESIC Specific Rules
    esic_wage_ceiling_standard?: number; // ₹21,000 gross/month
    esic_wage_ceiling_pwd?: number;      // ₹25,000 gross/month
    esic_employee_rate?: number;         // 0.0075 (0.75%)
    esic_employer_rate?: number;         // 0.0325 (3.25%)
    esic_min_daily_wage_exempt?: number;// ₹176/day exempt from employee share

    // Gratuity Rules
    gratuity_vesting_years?: number;     // 5.0 (or 4.657 for 4 yrs 240 days rule)
    gratuity_factor_numerator?: number;  // 15
    gratuity_factor_denominator?: number;// 26
    gratuity_statutory_tax_cap?: number; // ₹20,00,000
    gratuity_monthly_provision_rate?: number; // 0.0481 (4.81% of basic)

    // NPS Corporate Rules
    nps_employer_standard_rate?: number; // 0.10 (10% of Basic+DA under 80CCD(2))
    nps_employer_govt_psu_rate?: number; // 0.14 (14% of Basic+DA)
    nps_employee_80ccd1b_annual_cap?: number; // ₹50,000
    nps_overall_perquisite_cap?: number; // ₹7,50,000 combined annual limit (PF+NPS+Superannuation)
  };

  metadata: {
    gazette_notification_ref?: string;
    description: string;
    created_at: Timestamp | string;
    created_by: string;
  };
}


/* ============================================================================
 * 3. AUDIT TRAIL & MAKER-CHECKER RECORD INTERFACES
 * ============================================================================
 */

export interface AuditLogEntry {
  timestamp: Timestamp | string;
  user_id: string;
  user_email: string;
  user_role: string;
  action: string;
  previous_state?: string;
  new_state?: string;
  ip_address?: string;
  user_agent?: string;
  reason_or_notes?: string;
  checksum?: string;
}

export interface MakerCheckerStamp {
  maker_id: string;
  maker_name: string;
  maker_timestamp: Timestamp | string;
  checker_id: string | null;
  checker_name: string | null;
  checker_timestamp: Timestamp | string | null;
  checker_comments?: string | null;
  signature_hash?: string;
}


/* ============================================================================
 * 4. CORE DATA ENTITIES
 * ============================================================================
 */

/**
 * 4.1 EMPLOYEE COMPLIANCE PROFILE (Master Data for Statutory & Banking)
 * Firestore Collection: `/employees/{employee_id}/compliance_profile/current`
 */
export interface EmployeeComplianceProfile {
  employee_id: string;
  organization_id: string;
  full_name: string;
  date_of_birth: string;                 // YYYY-MM-DD
  gender: 'MALE' | 'FEMALE' | 'TRANSGENDER';
  date_of_joining: string;               // YYYY-MM-DD
  date_of_exit?: string | null;
  exit_reason?: 'RESIGNATION' | 'RETIREMENT' | 'DEATH' | 'DISABLEMENT' | 'TERMINATION' | null;
  is_pwd: boolean;                       // Person with Disability (ESIC ₹25k ceiling)
  international_worker: boolean;

  // Banking Details
  banking: {
    account_holder_name: string;
    account_number_raw: string;          // Encrypted in DB / accessible in memory for export
    account_number_masked: string;       // ••••••••1234
    ifsc_code: string;
    bank_name: string;
    branch_name?: string;
    is_verified: boolean;                // Penny-drop verified
    penny_drop_ref?: string;
  };

  // Statutory Identifiers
  statutory_identifiers: {
    pan: string;
    pan_verified: boolean;
    uan: string | null;                  // 12-digit PF Universal Account Number
    uan_status: 'ACTIVE' | 'NOT_ENROLLED' | 'EXEMPT';
    esic_ip_number: string | null;       // 10-digit Insurance Person Number
    esic_status: 'COVERED' | 'EXEMPT_WAGE_OVER_LIMIT' | 'NOT_APPLICABLE';
    nps_pran: string | null;             // 12-digit Permanent Retirement Account Number
    nps_status: 'OPTED_IN' | 'NOT_OPTED_IN';
    pt_state_jurisdiction: string;       // e.g. 'KA'
  };

  // Audit Fields
  version: number;
  created_at: Timestamp | string;
  updated_at: Timestamp | string;
  maker_checker: MakerCheckerStamp;
}


/**
 * 4.2 PAYROLL RUN (Monthly Salary Master Calculation)
 * Firestore Collection: `/payroll_runs/{payroll_run_id}`
 */
export interface PayrollRun {
  run_id: string;
  organization_id: string;
  payroll_cycle_month: string;           // '2026-08'
  pay_period_start: string;              // '2026-08-01'
  pay_period_end: string;                // '2026-08-31'
  status: PayrollRunStatus;

  // Aggregated Financial Totals
  totals: {
    total_headcount: number;
    total_gross_earnings: number;
    total_employee_deductions: number;
    total_employer_contributions: number;
    total_net_payable: number;
    total_tds_deductions: number;
    total_pf_liability: number;          // Employee + Employer + Admin
    total_esic_liability: number;        // Employee + Employer
    total_gratuity_provision: number;    // Monthly 4.81%
    total_nps_liability: number;         // Corporate + Voluntary
  };

  // Linked Batch ID references
  disbursement_batches: string[];        // Array of PaymentBatch IDs
  compliance_returns: string[];          // Array of ComplianceReturn IDs

  // Audit Fields
  version: number;
  created_at: Timestamp | string;
  updated_at: Timestamp | string;
  locked_at?: Timestamp | string | null;
  maker_checker: MakerCheckerStamp;
  audit_trail: AuditLogEntry[];
}


/**
 * 4.3 VALIDATION ISSUE (Granular 8-Point Gate / Regulatory Diagnostic)
 * Firestore Collection: `/validation_issues/{issue_id}` OR embedded within PaymentBatch
 */
export interface ValidationIssue {
  issue_id: string;
  batch_id?: string;
  run_id?: string;
  employee_id: string;
  employee_name: string;
  severity: ValidationSeverity;
  rule_code:
    | 'GATE_01_UNAPPROVED_RECORD'
    | 'GATE_02_CALC_MISMATCH'
    | 'GATE_03_INVALID_ACCOUNT_NO'
    | 'GATE_04_INVALID_IFSC'
    | 'GATE_05_DUPLICATE_RECORD'
    | 'GATE_06_ZERO_NEGATIVE_PAY'
    | 'GATE_07_EMPTY_REF_CODE'
    | 'GATE_08_LEDGER_MISMATCH'
    | 'STAT_PF_MISSING_UAN'
    | 'STAT_ESIC_MISSING_IP'
    | 'STAT_NPS_INVALID_PRAN'
    | 'STAT_GRATUITY_NON_VESTED_EXCESS';
  error_message: string;
  field_path: string;                    // e.g. 'banking.ifsc_code'
  current_value: any;
  suggested_fix?: string;
  is_resolved: boolean;
  resolved_by?: string;
  resolved_at?: Timestamp | string;
  resolution_notes?: string;
}


/**
 * 4.4 PAYMENT BATCH (Salary, Bonus, F&F, Vendor Disbursements)
 * Firestore Collection: `/payment_batches/{batch_id}`
 */
export interface PaymentBatch {
  batch_id: string;
  organization_id: string;
  payroll_run_id: string;
  batch_name: string;                    // e.g., "August 2026 Salary Disbursement - Core Staff"
  batch_type: 'SALARY' | 'BONUS' | 'FINAL_SETTLEMENT' | 'OFFCYCLE' | 'DIRECTOR_PAY';
  payment_rail: PaymentRail;
  status: PaymentBatchStatus;

  // Financial Ledger Balances
  summary: {
    total_records: number;
    valid_records_count: number;
    error_records_count: number;
    total_amount: number;
    currency: string;                    // 'INR'
  };

  // Associated Bank Export File & Settlement
  bank_file_id?: string | null;
  bank_response_id?: string | null;

  // Validation Gate Results
  validation_gate: {
    is_passed: boolean;
    last_validated_at: Timestamp | string;
    critical_errors_count: number;
    warnings_count: number;
    issues: ValidationIssue[];
  };

  // Audit Fields & 4-Eyes Control
  version: number;
  created_at: Timestamp | string;
  updated_at: Timestamp | string;
  maker_checker: MakerCheckerStamp;
  audit_trail: AuditLogEntry[];
}


/**
 * Subcollection item under `/payment_batches/{batch_id}/records/{record_id}`
 */
export interface PaymentDisbursementRecord {
  record_id: string;
  batch_id: string;
  employee_id: string;
  employee_name: string;
  email: string;

  // Banking (In-memory plain text / Masked for UI)
  account_number_masked: string;
  account_number_cipher_ref: string;     // Reference to KMS encrypted vault key
  ifsc_code: string;
  bank_name: string;

  // Pay Components
  gross_earnings: number;
  total_deductions: number;
  net_payable_amount: number;
  payment_reference: string;             // Client internal reference ID (KYLRX-DISB-XXXX)
  remarks: string;

  // Status & Settlement
  status: BankTransactionStatus;
  bank_utr?: string | null;
  failure_reason?: string | null;
  settled_at?: Timestamp | string | null;
}


/**
 * 4.5 BANK FILE (Client Bank Export Artifact)
 * Firestore Collection: `/bank_files/{bank_file_id}`
 */
export interface LegacyBankFileDoc {
  bank_file_id: string;
  batch_id: string;
  organization_id: string;
  bank_name: 'HDFC_ENET' | 'ICICI_CIB' | 'SBI_CMP' | 'AXIS_DIRECT' | 'STANDARD_CSV';
  format_type: 'CSV' | 'TXT_DELIMITED' | 'EXCEL_ENCRYPTED';
  file_name: string;
  file_size_bytes: number;
  storage_path: string;                  // Firebase Cloud Storage gs:// path
  checksum_sha256: string;               // Tamper-proof validation hash
  record_count: number;
  total_disbursed_amount: number;

  generated_by: {
    user_id: string;
    user_name: string;
    timestamp: string;
  };
}


/**
 * 4.6 BANK RESPONSE & RECONCILIATION
 * Firestore Collection: `/bank_reconciliations/{reconciliation_id}`
 */
export interface BankResponse {
  reconciliation_id: string;
  batch_id: string;
  organization_id: string;
  uploaded_file_name: string;
  parsed_records_count: number;
  matched_records_count: number;
  success_count: number;
  failure_count: number;
  total_settled_amount: number;
  total_failed_amount: number;

  // Detailed Transaction Settlements
  settlements: Array<{
    internal_reference_id: string;
    employee_id: string;
    beneficiary_name: string;
    account_number_masked: string;
    disbursed_amount: number;
    bank_utr: string;
    transaction_status: BankTransactionStatus;
    failure_code?: string;
    failure_reason?: string;
    settlement_timestamp: string;
  }>;

  reconciled_by: {
    user_id: string;
    timestamp: Timestamp | string;
  };
  audit_trail: AuditLogEntry[];
}


/**
 * 4.7 COMPLIANCE RETURN (Statutory Filing Manifest)
 * Firestore Collection: `/compliance_returns/{return_id}`
 */
export interface ComplianceReturn {
  return_id: string;
  organization_id: string;
  payroll_run_id: string;
  statutory_head: StatutoryHead;
  wage_month: string;                    // '2026-08'
  policy_version_applied: number;
  status: ComplianceFilingStatus;

  // Statutory Identifier checked
  identifier_type: 'UAN' | 'IP_NO' | 'PRAN' | 'PAN';

  // Summary Metrics
  summary: {
    total_eligible_headcount: number;
    total_statutory_wages: number;
    total_employee_deductions: number;
    total_employer_liability: number;
    total_payable_challan: number;
  };

  // Exceptions / Anomalies
  exceptions: Array<{
    employee_id: string;
    employee_name: string;
    missing_or_invalid_field: string;
    exception_reason: string;
    is_resolved: boolean;
  }>;

  // Generated Portal Upload Artifacts
  export_artifact: {
    file_type: 'ECR_TXT' | 'ESIC_CSV' | 'NPS_SCF_TXT' | 'GRATUITY_FORM_I_PDF';
    file_name: string;
    storage_path: string;
    checksum_sha256: string;
    generated_at?: Timestamp | string;
  };

  // Portal Filing & Challan Details
  challan_details?: {
    trrn_or_challan_no?: string;
    portal_acknowledgment_ref?: string;
    due_date: string;                    // e.g., '2026-09-15'
    paid_date?: string | null;
    challan_receipt_url?: string | null;
    payment_utr?: string | null;
  };

  // Audit Fields
  version: number;
  created_at: Timestamp | string;
  updated_at: Timestamp | string;
  maker_checker: MakerCheckerStamp;
  audit_trail: AuditLogEntry[];
}

/* ============================================================================
 * 5. PAYROLL FREEZE & BATCH STATE ISOLATION (CRITERIA 1 & 4)
 * ============================================================================
 */

/**
 * 5.1 Criteria 1: Versioned, Read-Only Frozen Snapshot of Payroll Run
 * Firestore Collection: `/payroll_run_snapshots/{snapshot_id}`
 */
export interface PayrollRunSnapshot {
  snapshot_id: string;                  // Canonical ID: SNAP_{run_id}_v{version}
  run_id: string;
  organization_id: string;
  version: number;                      // Monotonically increasing version counter
  payroll_cycle_month: string;          // e.g., '2026-08'
  pay_period_start: string;
  pay_period_end: string;
  status: 'FINALIZED';
  is_frozen: true;                      // Immutability flag
  is_immutable: true;
  frozen_at: string;                    // ISO-8601 timestamp
  frozen_by: string;                    // User / Admin ID
  checksum_sha256: string;              // Cryptographic payload hash for tamper verification

  totals: {
    total_headcount: number;
    total_gross_earnings: number;
    total_employee_deductions: number;
    total_employer_contributions: number;
    total_net_payable: number;
    total_tds_deductions: number;
    total_pf_liability: number;
    total_esic_liability: number;
    total_gratuity_provision: number;
    total_nps_liability: number;
    total_pt_liability: number;
  };

  // Deep-frozen, read-only employee calculation details
  employees: ReadonlyArray<{
    employee_id: string;
    employee_name: string;
    gross_earnings: number;
    basic_wage: number;
    total_deductions: number;
    net_payable: number;
    pf_employee_share: number;
    pf_employer_share: number;
    esic_employee_share: number;
    esic_employer_share: number;
    professional_tax: number;
    tds_deduction: number;
    nps_employee_share: number;
    nps_employer_share: number;
    gratuity_provision: number;
    bank_account_number: string;
    ifsc_code: string;
    pan: string;
    uan?: string | null;
    esic_ip?: string | null;
    nps_pran?: string | null;
    payment_reference: string;
  }>;

  ledger_summary: {
    salary_payable_ledger: string;
    pf_liability_ledger: string;
    esic_liability_ledger: string;
    pt_payable_ledger: string;
    tds_payable_ledger: string;
    nps_payable_ledger: string;
    gratuity_provision_ledger: string;
  };

  metadata: Record<string, any>;
}

/**
 * 5.2 Criteria 4: Independent Domain Batch Lifecycle Units
 */
export type BatchDomainType =
  | 'SALARY'
  | 'PF'
  | 'ESI'
  | 'PROFESSIONAL_TAX'
  | 'TDS'
  | 'GRATUITY'
  | 'NPS';

export interface IsolatedBatchLedgerReferences {
  general_ledger_code: string;
  liability_account: string;
  contra_account: string;
  cost_center: string;
  journal_voucher_ref: string;
}

export interface IsolatedDomainBatch {
  batch_id: string;                     // Unique: BATCH-{period}-{DOMAIN}-{id}
  run_id: string;
  snapshot_id: string;                  // Direct reference to frozen snapshot
  batch_type: BatchDomainType;
  status: PaymentBatchStatus;           // DRAFT -> VALIDATED -> APPROVED -> SUBMITTED -> PAID (or FAILED)
  scheduled_payment_date: string;       // YYYY-MM-DD independent date
  ledger_references: IsolatedBatchLedgerReferences;
  total_records: number;
  total_amount: number;
  currency: 'INR';
  is_settled: boolean;
  settled_at: string | null;
  bank_ref?: string | null;
  records: Array<{
    record_id: string;
    employee_id: string;
    employee_name: string;
    amount: number;
    payment_reference: string;
    account_or_identifier: string;
    clearing_status: BankTransactionStatus;
  }>;
  created_at: string;
  updated_at: string;
}

/* ============================================================================
 * 11. CRITERIA 2, 3 & 12: STATE GATEKEEPERS, MAKER-CHECKER & SECURITY SCHEMAS
 * ============================================================================
 */

/**
 * Criteria 2: Pre-state-change Validation Gatekeeper.
 */
export interface ValidationGatekeeperEvaluation {
  allowed: boolean;
  target_state: 'APPROVED' | 'FILE_GENERATED' | string;
  batch_id: string;
  blocking_count: number;
  blocking_issues: Array<{
    code: string;
    employee_id?: string;
    field?: string;
    severity: 'BLOCK' | 'BLOCKING';
    message: string;
  }>;
}

/**
 * Criteria 3: Maker-Checker Segregation Evaluation.
 */
export interface MakerCheckerEvaluation {
  authorized: boolean;
  batch_id: string;
  maker_id: string;
  checker_id: string;
  evaluated_at: string;
  violation_detected: boolean;
}

/**
 * Criteria 12: Cryptographically Signed Privileged Export Job Manifest.
 */
export interface PrivilegedExportJobManifest {
  export_job_id: string;
  batch_id: string;
  authorized_by: string;
  authorized_role: string;
  purpose: 'BANK_CLEARING_FILE' | 'STATUTORY_RETURN' | 'TREASURY_TRANSFER';
  created_at: string;
  expires_at: string;
  signature: string;                    // HMAC-SHA256 digital signature
  is_verified: boolean;
}

/* ============================================================================
 * 12. CRITERIA 5 & 6: BANK FILE METADATA & STRICT IDEMPOTENCY SCHEMAS
 * ============================================================================
 */

/**
 * Criteria 5: Versioned Bank File Document with Cryptographic Checksum.
 */
export interface BankFile {
  file_id: string;                      // Unique identifier: BF_{timestamp}_{uuid}
  version: number;                      // Version counter (1, 2, ...)
  checksum: string;                     // SHA-256 hash across raw output content
  source_batch_id: string;              // Bound PaymentBatch ID
  row_count: number;                    // Total disbursement instruction rows
  total_amount: number;                 // Sum of net payable values
  generated_at: string;                 // ISO-8601 timestamp
  file_name?: string;
  format?: 'CSV' | 'TXT' | string;
  content?: string;
  reissued_from_file_id?: string | null;
  reissue_reason?: string | null;
  is_locked: boolean;
}

/**
 * Criteria 6: Deterministic Idempotency Instruction Record.
 */
export interface IdempotencyInstructionRecord {
  instruction_key: string;              // SHA256(period + employee_id + batch_type + amount + account_version)
  instruction_id: string;
  period: string;
  employee_id: string;
  batch_type: string;
  amount: number;
  account_version: number;
  reissue_sequence: number;
  source_batch_id: string;
  status: 'PENDING' | 'SUBMITTED' | 'SUCCESSFUL' | 'SETTLED' | 'REISSUED' | 'REVERSED';
  processed_in_file_id?: string;
  processed_at?: string;
}

/* ============================================================================
 * 12. CRITERION 7: BANK RESPONSE INGESTION & TRANSACTION RECONCILIATION
 * ============================================================================
 */

export enum ReconciliationDiscrepancyType {
  UNMATCHED_ROW = 'UNMATCHED_ROW',                 // Row could not be mapped to any batch instruction (orphaned)
  AMOUNT_MISMATCH = 'AMOUNT_MISMATCH',             // Cleared amount does not equal instructed amount (Δ ≠ 0)
  DUPLICATE_BANK_REF = 'DUPLICATE_BANK_REF',       // UTR/bank_ref seen multiple times in run or historic ledger
  DUPLICATE_TXN_ID = 'DUPLICATE_TXN_ID',           // Txn ID seen multiple times in run or historic ledger
  FAN_IN_COLLISION = 'FAN_IN_COLLISION',           // Multiple bank rows mapped to the same internal instruction
  AMBIGUOUS_CONFIRMATION = 'AMBIGUOUS_CONFIRMATION'// Bank response lacks positive confirmation or non-blank UTR
}

export type ReconciliationDiscrepancyStatus = 'OPEN' | 'RESOLVED' | 'WAIVED';

export interface BankResponseRow {
  txn_id: string;                                  // Primary internal reference or bank txn ID
  bank_ref: string;                                // Clearing UTR / trace reference
  employee_id?: string;                            // Beneficiary employee ID if present
  cleared_amount: number;                          // Financial amount cleared by bank
  raw_status: string;                              // Raw status from clearing file
  normalised_status: 'PAID' | 'FAILED' | 'PENDING';// Normalised clearing status
  failure_reason?: string | null;                  // Return or rejection code/message
  settlement_timestamp: string;                    // Settlement timestamp ISO
  bank_confirmation_present: boolean;              // True only when status is positive and UTR is non-blank
  raw_row?: any;
}

export interface ReconciliationDiscrepancy {
  exception_id: string;                            // Unique identifier (EXC_...)
  batch_id: string;                                // Bound PaymentBatch ID
  discrepancy_type: ReconciliationDiscrepancyType;
  txn_id: string | null;                           // Referenced bank transaction ID
  bank_ref: string | null;                         // Bank trace / UTR reference
  employee_id: string | null;                      // Employee ID if matched
  instruction_id: string | null;                   // Internal instruction / record ID
  instructed_amount: number | null;                // Expected instructed amount
  cleared_amount: number | null;                   // Reported cleared amount
  difference_amount: number;                       // Mandatory signed delta: cleared_amount - instructed_amount
  reason: string;                                  // Audit description of discrepancy
  affected_field: string | null;                   // 'cleared_amount' | 'bank_ref' | 'txn_id'
  status: ReconciliationDiscrepancyStatus;         // OPEN | RESOLVED | WAIVED
  source_row: Partial<BankResponseRow> | null;
  resolved_by?: string | null;
  resolved_at?: string | null;
  resolution_action?: string | null;
  resolution_notes?: string | null;
  created_at: string;
}

export interface ManualResolutionAction {
  action: 'MANUAL_MATCH' | 'ACCEPT_DIFFERENCE' | 'FORCE_SETTLE' | 'MARK_FAILED_FOR_RETRY' | 'WAIVE';
  resolved_by: string;
  notes: string;
  override_instruction_id?: string;
  cleared_amount_override?: number;
}

export interface BatchReconciliationResult {
  batch_id: string;
  status: 'RECONCILING' | 'PAID' | 'FAILED' | 'PARTIALLY_SETTLED';
  total_instructions: number;
  matched_count: number;
  unmatched_count: number;
  settled_count: number;                           // PAID with positive confirmation
  failed_count: number;                            // FAILED by bank
  open_exception_count: number;
  auto_closure_blocked: boolean;                   // true if open exceptions exist
  reconciliation_exceptions: ReconciliationDiscrepancy[];
  reconciled_at: string;
}

/* ============================================================================
 * 13. CRITERIA 8, 9 & 10: MODULAR STATUTORY WORKFLOWS
 * ============================================================================
 */

/**
 * Criterion 8: ESIC Multi-Stage Pipeline Stages & Results
 */
export enum EsicPipelineStage {
  PROFILE_MASTER_SYNC = 'PROFILE_MASTER_SYNC',
  CALCULATION = 'CALCULATION',
  FORMAT_VALIDATION = 'FORMAT_VALIDATION',
  EXCEPTION_QUEUE = 'EXCEPTION_QUEUE',
  RETURN_LAYOUT_MAPPING = 'RETURN_LAYOUT_MAPPING',
  OUTPUT_GENERATION = 'OUTPUT_GENERATION',
}

export interface EsicPipelineStageTrace {
  stage: EsicPipelineStage;
  stage_order: number;
  input_count: number;
  output_count: number;
  executed_at: string;
  metadata?: Record<string, any>;
}

export interface EsicPipelineResult {
  run_id: string;
  period: string;
  policy_version_id: string;
  total_candidates: number;
  compliant_ip_count: number;
  exception_count: number;
  non_applicable_count: number;
  total_wages: number;
  total_employee_deduction_0_75: number;
  total_employer_contribution_3_25: number;
  total_challan_liability: number;
  stages_executed: EsicPipelineStageTrace[];
  clean_return_records: any[];
  esic_exceptions: any[];
  csv_output: {
    file_name: string;
    content: string;
    checksum_sha256: string;
  };
  excel_matrix_output: {
    headers: string[];
    rows: any[][];
    row_count: number;
  };
  generated_at: string;
}

/**
 * Criterion 9: Gratuity Traceable Execution Receipt & Calculation Models
 */
export interface GratuityExecutionReceipt {
  receipt_id: string;
  employee_id: string;
  policy_version_id: string;
  policy_config_id: string;
  date_of_joining: string;
  date_of_exit: string;
  exit_reason: string;
  last_drawn_basic: number;
  last_drawn_da: number;
  salary_basis: number;                            // Basic + DA
  continuous_service_days: number;
  completed_service_factor: number;                // Statutory years factor
  tenure_years_raw: number;
  service_rounding_rule_applied: string;
  days_per_year_factor: number;                    // 15
  working_days_divisor: number;                    // 26
  raw_formula_output: number;                      // (SalaryBasis * Factor * 15) / 26
  statutory_tax_free_cap: number;                  // 20,00,000
  is_vested: boolean;
  vesting_bypass_applied: boolean;
  vesting_bypass_reason: string | null;
  tax_exempt_amount: number;
  taxable_amount: number;
  final_payable_amount: number;
  nominee_allocations: Array<{ nominee_name: string; share_percentage: number; amount: number }>;
  execution_timestamp: string;
}

export interface GratuityCalculationResult {
  success: boolean;
  employee_id: string;
  final_payable_amount: number;
  is_vested: boolean;
  execution_receipt: GratuityExecutionReceipt;
}

/**
 * Criterion 10: NPS Pre-Export Validation & NSDL CRA SCF File Models
 */
export interface NpsPreExportRecordValidation {
  employee_id: string;
  pran: string;
  pran_valid: boolean;
  tier_type: string;
  tier_valid: boolean;
  contribution_type: string;
  employee_share: number;
  employer_share: number;
  salary_basis: number;
  sec80ccd1_valid: boolean;                        // EE <= 10%
  sec80ccd2_valid: boolean;                        // ER <= 10% (corporate) or 14% (govt)
  sec80ccd1b_valid: boolean;                       // Voluntary excess <= ₹50K
  is_valid: boolean;
  validation_errors: string[];
}

export interface NpsValidationAndExportResult {
  source_run_id: string;
  period: string;
  month_year: string;
  all_data_checks_passed: boolean;
  total_candidates: number;
  valid_subscribers_count: number;
  rejected_count: number;
  validation_details: NpsPreExportRecordValidation[];
  validation_issues: any[];
  scf_file: {
    file_name: string;
    file_content: string;
    checksum_sha256: string;
    record_counts: {
      fh_count: number;
      bh_count: number;
      sd_count: number;
      ft_count: number;
      total_lines: number;
    };
    total_employee_contribution: number;
    total_employer_contribution: number;
    grand_total_contribution: number;
  } | null;
  generated_at: string;
}

/* ============================================================================
 * CRITERION 11: CENTRALIZED COMPLIANCE AUDIT LOGGER & EVENT STREAMING TYPES
 * ============================================================================
 */

export type AuditEntityType = 'PayrollRun' | 'PaymentBatch' | 'ComplianceReturn' | string;

export interface ComplianceAuditEvent {
  /** Unique audit event identifier: evt_{timestamp}_{randomHex} */
  event_id: string;

  /** Domain entity type: PayrollRun | PaymentBatch | ComplianceReturn */
  entity_type: AuditEntityType;

  /** Primary entity ID (e.g. RUN_2026_09, BATCH-2026-09-SAL, CR_ESIC_2026_09) */
  entity_id: string;

  /** Previous state enum (null for initial entity creation) */
  from_state: string | null;

  /** Destination state enum */
  to_state: string;

  /** Identity of actor / user who triggered state transition */
  actor_id: string;

  /** Role / privilege level of actor (e.g. PAYROLL_ADMIN, MAKER, CHECKER, SYSTEM_SERVICE) */
  actor_role: string;

  /** ISO-8601 UTC timestamp of state transition */
  timestamp: string;

  /** Version of business / statutory compliance rule applied during transition */
  rule_version_applied: string;

  /** Distributed correlation ID propagating across API boundaries */
  correlation_id: string;

  /** Optional non-financial metadata / context payload */
  metadata?: Record<string, any>;

  // ── Backward-compatible property aliases ──────────────────────────────────
  transition_id?: string;
  entity?: string;
  from?: string | null;
  to?: string;
}

export interface AuditQueryFilter {
  /** Filter by entity type (case-insensitive: PayrollRun, PaymentBatch, ComplianceReturn) */
  entity_type?: string;

  /** Filter by exact entity ID */
  entity_id?: string;

  /** Filter by distributed correlation ID */
  correlation_id?: string;

  /** Earliest timestamp (inclusive ISO-8601 string) */
  from_date?: string;

  /** Latest timestamp (inclusive ISO-8601 string) */
  to_date?: string;

  /** Actor identity filter */
  actor_id?: string;

  /** Actor role filter */
  actor_role?: string;

  /** Source state filter */
  from_state?: string;

  /** Target state filter */
  to_state?: string;

  /** Statutory / business rule version filter */
  rule_version_applied?: string;

  /** Max records per page (default 50, max 500) */
  limit?: number;

  /** Pagination offset */
  offset?: number;
}

export interface AuditQueryResult {
  total: number;
  limit: number;
  offset: number;
  count: number;
  events: ComplianceAuditEvent[];
  timeline: ComplianceAuditEvent[];
}

