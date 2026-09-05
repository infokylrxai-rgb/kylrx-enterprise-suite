/**
 * ============================================================================
 * KYLRX AI ENTERPRISE HRMS - EMPLOYEE PF STATUTORY POLICY & PROFILE SCHEMA
 * ============================================================================
 * TypeScript domain entities, validation constraints, and ingestion models
 * for the Employee Provident Fund (EPFO) & Pension Scheme (EPS) subsystem.
 *
 * @version 6.1.0
 * @author Kylrx AI Principal Backend Architect
 */

/**
 * Statutory contribution type policy:
 * - STANDARD: Standard statutory formula (12% of EPF wages, capped at statutory wage ceiling ₹15,000)
 * - RESTRICTED_15K: Explicitly capped at ₹15,000 wage ceiling regardless of higher basic pay
 * - ACTUAL_WAGE: Full contribution on actual Basic + DA without applying statutory ceiling
 */
export type PFContributionType = 'STANDARD' | 'RESTRICTED_15K' | 'ACTUAL_WAGE';

export const VALID_PF_CONTRIBUTION_TYPES: PFContributionType[] = [
  'STANDARD',
  'RESTRICTED_15K',
  'ACTUAL_WAGE',
];

/**
 * Strict 12-digit numeric Universal Account Number (UAN) format
 */
export const UAN_STRICT_12_DIGIT_REGEX = /^[0-9]{12}$/;

/**
 * Standard EPFO regional PF Member ID regex:
 * Supports regional patterns such as:
 * - KN/12345/1234567
 * - MH/BAN/0012345/000/0000101
 * - DL/CPM/0001234/000/0000567
 */
export const PF_MEMBER_ID_REGIONAL_REGEX =
  /^[A-Z]{2}(?:\/[A-Z0-9]{1,7})?\/(?:[0-9]{1,7})\/(?:[0-9]{1,7})(?:\/[0-9]{1,7})?$/i;

/**
 * Fallback permissive pattern for regional member IDs containing standard state code and numeric establishment/member tokens
 */
export const PF_MEMBER_ID_PERMISSIVE_REGEX =
  /^[A-Z]{2}\/[A-Z0-9/_-]{5,30}$/i;

/**
 * Canonical Employee PF Profile Entity
 */
export interface EmployeePFProfile {
  employee_id: string;                      // Unique Employee Identifier (e.g. EMP001)
  employee_name?: string;                   // Member Full Name
  uan: string;                              // Universal Account Number (strictly 12 numeric digits if pf_applicable)
  pf_member_id: string;                     // Regional Member ID (e.g. KN/12345/1234567)
  pf_applicable: boolean;                   // PF Scheme Eligibility Flag
  pf_join_date: string;                     // ISO Date YYYY-MM-DD (Date of joining PF scheme)
  pf_exit_date: string | null;              // ISO Date YYYY-MM-DD or null if currently active member
  eps_applicable: boolean;                  // Pension Scheme (EPS) Eligibility Flag
  contribution_type: PFContributionType;    // STANDARD | RESTRICTED_15K | ACTUAL_WAGE
  voluntary_pf_percent: number;             // Voluntary PF (VPF) additional percentage (0 to 88%)
  voluntary_pf_amount?: number;             // Optional fixed VPF monthly rupee deduction
  is_active?: boolean;                      // Computed active status (pf_applicable && !pf_exit_date)
  created_at?: string;                      // ISO Timestamp
  updated_at?: string;                      // ISO Timestamp
  version?: number;                         // Optimistic concurrency control version
}

/**
 * Raw Ingestion Row from Employee_PF_Master.xlsx / CSV
 */
export interface PFIngestionRow {
  employee_id: string;
  employee_name?: string;
  uan?: string;
  pf_member_id?: string;
  pf_applicable?: boolean | string | number;
  pf_join_date?: string;
  pf_exit_date?: string | null;
  eps_applicable?: boolean | string | number;
  contribution_type?: PFContributionType | string;
  voluntary_pf_percent?: number | string;
  voluntary_pf_amount?: number | string;
}

/**
 * Staging Rejection Log Entity with exact line and column coordinates
 */
export interface PFStagingRejection {
  rejection_id: string;                     // Unique Rejection Event ID
  batch_id: string;                         // Ingestion Batch Identifier
  line_number: number;                      // 1-indexed file row/line coordinate
  column_name: string;                      // Offending field / column header
  rejected_value: string | number | null;   // Actual raw invalid value ingested
  error_code:
    | 'ERR_MISSING_EMPLOYEE_ID'
    | 'ERR_MANDATORY_UAN_MISSING'
    | 'ERR_INVALID_UAN_FORMAT'
    | 'ERR_MANDATORY_MEMBER_ID_MISSING'
    | 'ERR_INVALID_MEMBER_ID_FORMAT'
    | 'ERR_INVALID_JOIN_DATE'
    | 'ERR_INVALID_EXIT_DATE'
    | 'ERR_DATE_SEQUENCE_VIOLATION'
    | 'ERR_INVALID_CONTRIBUTION_TYPE'
    | 'ERR_INVALID_VPF_PERCENT'
    | 'ERR_DUPLICATE_UAN'
    | 'ERR_DUPLICATE_MEMBER_ID'
    | 'ERR_STRUCTURAL_MALFORMED';
  error_message: string;                    // Human-readable technical diagnostic
  suggested_action: string;                 // Remediation guidance for compliance officer
  timestamp: string;                        // ISO Timestamp
}

/**
 * Transactional Ingestion Batch Result Manifest
 */
export interface PFBulkIngestionResult {
  batch_id: string;
  source_file: string;
  total_rows: number;
  committed_rows_count: number;
  rejected_rows_count: number;
  committed_profiles: EmployeePFProfile[];
  rejection_logs: PFStagingRejection[];
  execution_duration_ms?: number;
  ingested_at: string;
}
