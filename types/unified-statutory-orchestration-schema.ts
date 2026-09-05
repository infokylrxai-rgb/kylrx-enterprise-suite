/**
 * ============================================================================
 * KYLRX AI ENTERPRISE HRMS - UNIFIED STATUTORY ORCHESTRATION SCHEMA
 * ============================================================================
 * Defines typed contracts for the Unified Statutory Orchestration Service
 * connecting ESIC, Gratuity, and NPS to the Kylrx AI HRMS Firebase backend.
 *
 * Staging Collections:
 *  - `/payroll_runs/{payroll_run_id}` (Trigger Document, status: 'FINALIZED')
 *  - `/esic_compliance_batches/{batch_id}`
 *  - `/gratuity_settlements/{batch_id}`
 *  - `/nps_compliance_batches/{batch_id}`
 *  - `/statutory_exceptions/{exception_id}`
 *
 * @version 4.0.0
 * @author Kylrx AI Lead Backend Compliance Engineer
 */

export type StatutoryScheme = 'ESIC' | 'GRATUITY' | 'NPS';

export type StatutoryExceptionSeverity = 'BLOCK' | 'WARNING';

export interface PayrollRunTriggerDocument {
  payroll_run_id: string;
  run_id?: string;
  period: string; // YYYY-MM
  status: 'FINALIZED' | 'COMPLETED' | string;
  finalized_at: string;
  finalized_by?: string;
  total_gross?: number;
  total_net?: number;
  currency?: string;
  employees: Array<{
    employee_id: string;
    employee_name?: string;
    basic?: number;
    da?: number;
    gross_salary?: number;
    net_salary?: number;
    esic_applicable?: boolean;
    esic_number?: string;
    ip_number?: string;
    disability_percentage?: number;
    date_of_joining?: string;
    date_of_exit?: string | null;
    exit_reason?: string | null;
    gratuity_eligible?: boolean;
    last_drawn_salary?: number;
    nominee_details?: Array<{
      name: string;
      relation: string;
      share_percentage: number;
    }>;
    nps_applicable?: boolean;
    pran?: string;
    tier?: 'Tier I' | 'Tier II' | 'TIER_1' | 'TIER_2';
    contribution_type?: 'Employee' | 'Employer' | 'Both' | string;
    voluntary_monthly_amount?: number;
    uan?: string;
    account_number?: string;
  }>;
}

export interface EsicComplianceBatchDocument {
  batch_id: string;
  source_payroll_id: string;
  period: string;
  scheme: 'ESIC';
  rule_version: string;
  status: string;
  total_subscribers: number;
  total_wages: number;
  total_employee_amount: number;
  total_employer_amount: number;
  total_contribution_amount: number;
  unresolved_blocking_count: number;
  is_blocked: boolean;
  file_manifest?: {
    txt_file_name: string;
    txt_checksum_sha256: string;
    xls_file_name: string;
    xls_checksum_sha256: string;
    generated_at: string;
  };
  created_at: string;
  updated_at: string;
}

export interface GratuitySettlementDocument {
  batch_id: string;
  source_payroll_id: string;
  period: string;
  scheme: 'GRATUITY';
  rule_version: string;
  status: string;
  total_candidates: number;
  total_eligible_count: number;
  total_ineligible_count: number;
  total_gratuity_payable: number;
  is_maker_checker_approved: boolean;
  approved_by?: string | null;
  file_manifest?: {
    file_name: string;
    checksum_sha256: string;
    row_count: number;
    generated_at: string;
  };
  created_at: string;
  updated_at: string;
}

export interface NpsComplianceBatchDocument {
  batch_id: string;
  source_payroll_id: string;
  period: string;
  scheme: 'NPS';
  rule_version: string;
  status: string;
  total_subscribers: number;
  total_employee_amount: number;
  total_employer_amount: number;
  total_contribution_amount: number;
  unresolved_blocking_count: number;
  is_blocked: boolean;
  prn_acknowledgement_token?: string | null;
  file_manifest?: {
    file_name: string;
    checksum_sha256: string;
    row_count: number;
    generated_at: string;
  };
  created_at: string;
  updated_at: string;
}

export interface SharedStatutoryExceptionDocument {
  exception_id: string;
  scheme: StatutoryScheme;
  source_payroll_id: string;
  batch_id: string;
  employee_id: string;
  employee_name: string;
  error_code: string;
  field?: string;
  actual_value?: any;
  severity: StatutoryExceptionSeverity;
  message: string;
  suggested_fix?: string;
  resolved: boolean;
  resolved_at?: string | null;
  resolved_by?: string | null;
  rule_version_applied: string;
  created_at: string;
  updated_at: string;
}

export interface OrchestrationExecutionManifest {
  orchestration_id: string;
  source_payroll_id: string;
  period: string;
  triggered_at: string;
  completed_at: string;
  duration_ms: number;
  workers: {
    esic: {
      success: boolean;
      batch_id: string;
      subscribers_count: number;
      total_amount: number;
      checksum_sha256?: string;
      error?: string;
    };
    gratuity: {
      success: boolean;
      batch_id: string;
      eligible_count: number;
      total_amount: number;
      checksum_sha256?: string;
      error?: string;
    };
    nps: {
      success: boolean;
      batch_id: string;
      subscribers_count: number;
      total_amount: number;
      checksum_sha256?: string;
      error?: string;
    };
  };
  total_exceptions_count: number;
  blocking_exceptions_count: number;
  audit_correlation_id: string;
}
