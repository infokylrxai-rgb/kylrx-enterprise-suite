/**
 * ============================================================================
 * KYLRX AI ENTERPRISE HRMS - PAYROLL DISBURSEMENT API CONTRACTS & OPENAPI ENVELOPES
 * ============================================================================
 * Standardized typed API contracts, request/response envelopes, and OpenAPI
 * schemas for the Kylrx AI Payroll Disbursement Microservices.
 *
 * @version 4.0.0
 * @author Kylrx AI Principal Backend Architect
 */

/**
 * Standard Success API Response Envelope.
 */
export interface ApiSuccessEnvelope<T = any> {
  success: true;
  data: T;
  meta: {
    timestamp: string;
    request_id: string;
    version: string;
    immutable?: boolean;
  };
}

/**
 * Standard Error API Response Envelope.
 */
export interface ApiErrorEnvelope {
  success: false;
  error: {
    code: string;
    message: string;
    details?: any;
    timestamp: string;
    request_id: string;
  };
}

export type ApiResponse<T = any> = ApiSuccessEnvelope<T> | ApiErrorEnvelope;

/**
 * 1. Payroll Service Contracts
 */
export interface FinalizePayrollRunRequest {
  admin_id: string;
  notes?: string;
  lock_attendance?: boolean;
}

export interface FinalizePayrollRunResponse {
  run_id: string;
  period: string;
  status: 'FINALIZED';
  total_employees: number;
  gross_payroll: number;
  total_deductions: number;
  net_payable: number;
  finalized_at: string;
  finalized_by: string;
  is_immutable: true;
}

/**
 * 2. Payment Batch Service Contracts
 */
export interface CreatePaymentBatchRequest {
  run_id: string;
  batch_type: 'SALARY' | 'VENDOR' | 'STATUTORY' | 'FINAL_SETTLEMENT';
  debit_account_number?: string;
  scheduled_date?: string;
  maker_id: string;
  maker_role?: string;
}

export interface PaymentBatchResponse {
  batch_id: string;
  run_id: string;
  state: string;
  batch_type: string;
  total_records: number;
  total_amount: number;
  debit_account_number: string;
  maker_id: string;
  checker_id: string | null;
  created_at: string;
  updated_at: string;
}

/**
 * 3. Validation Service Contracts
 */
export interface ValidatePaymentBatchResponse {
  batch_id: string;
  status: 'PASSED' | 'FAILED' | 'WARNING';
  is_blocked: boolean;
  total_evaluated: number;
  blocking_issues_count: number;
  warning_issues_count: number;
  issues: Array<{
    issue_id: string;
    code: string;
    severity: 'BLOCK' | 'WARN';
    field: string | null;
    message: string;
    suggested_fix: string;
  }>;
  validated_at: string;
}

/**
 * 4. Approval Service Contracts
 */
export interface SubmitForApprovalRequest {
  maker_id: string;
  comments?: string;
}

export interface ApprovePaymentBatchRequest {
  checker_id: string;
  checker_role?: string;
  decision: 'APPROVE' | 'REJECT';
  comments?: string;
}

export interface ApprovalResponse {
  batch_id: string;
  state: 'APPROVED' | 'REJECTED' | 'PENDING_APPROVAL';
  maker_id: string;
  checker_id: string | null;
  approval_timestamp: string;
  approved_snapshot?: {
    total_amount: number;
    record_count: number;
    checksum: string;
  };
}

/**
 * 5. File Service Contracts
 */
export interface GenerateDisbursementFileRequest {
  format?: 'STANDARD_CSV' | 'PIPED_TXT' | 'XML_PAIN001' | 'EXCEL';
  encryption_enabled?: boolean;
}

export interface GenerateDisbursementFileResponse {
  file_id: string;
  batch_id: string;
  file_name: string;
  mime_type: string;
  file_size_bytes: number;
  checksum_sha256: string;
  total_records: number;
  total_amount: number;
  download_url: string;
  generated_at: string;
}

/**
 * 6. Bank Integration Service Contracts
 */
export interface BankSubmissionRequest {
  batch_id: string;
  gateway_code: 'HDFC_ENET' | 'ICICI_CIB' | 'AXIS_DIRECT' | 'SBI_CMP' | 'NSDL_CRA';
  actor_id: string;
}

export interface BankSubmissionResponse {
  submission_id: string;
  batch_id: string;
  status: 'SUBMITTED' | 'ACCEPTED' | 'REJECTED';
  acknowledgement_reference: string;
  gateway_timestamp: string;
}

export interface BankResponseImportRequest {
  gateway_code: string;
  batch_id?: string;
  raw_payload: string | Record<string, any>;
  format?: 'XML' | 'JSON' | 'CSV' | 'TXT';
}

export interface BankResponseImportResponse {
  import_id: string;
  batch_id: string;
  clearing_status: 'SUCCESS' | 'PARTIAL' | 'FAILED';
  acknowledged_count: number;
  rejected_count: number;
  processed_at: string;
}

/**
 * 7. Compliance Engine Contracts
 */
export interface ComplianceCalculateRequest {
  scheme: 'ESIC' | 'NPS' | 'GRATUITY' | 'PF';
  period: string;
  candidates: any[];
  options?: Record<string, any>;
}

export interface ComplianceGenerateRequest {
  scheme: 'ESIC' | 'NPS' | 'GRATUITY' | 'PF';
  period: string;
  records: any[];
  options?: Record<string, any>;
}

export interface ComplianceResponse {
  scheme: 'ESIC' | 'NPS' | 'GRATUITY' | 'PF';
  period: string;
  file_name?: string;
  checksum_sha256?: string;
  total_candidates: number;
  total_liability: number;
  summary: Record<string, any>;
  generated_at: string;
}

/**
 * 8. Audit Service Contracts
 */
export interface AuditQueryFilter {
  entity_type?: string;
  entity_id?: string;
  actor_id?: string;
  event_type?: string;
  from_date?: string;
  to_date?: string;
  limit?: number;
}

export interface AuditLogEntry {
  log_id: string;
  entity_type: string;
  entity_id: string;
  event: string;
  actor_id: string;
  actor_role: string;
  timestamp: string;
  metadata?: Record<string, any>;
}

/**
 * 9. Criteria 1 & 4: Payroll Freeze & Batch State Isolation Contracts
 */
export interface GetPayrollSnapshotResponse {
  snapshot_id: string;
  run_id: string;
  version: number;
  status: 'FINALIZED';
  is_frozen: true;
  is_immutable: true;
  frozen_at: string;
  frozen_by: string;
  checksum_sha256: string;
  totals: Record<string, number>;
  employee_count: number;
}

export interface CreateIsolatedDomainBatchRequest {
  run_id: string;
  batch_type: 'SALARY' | 'PF' | 'ESI' | 'PROFESSIONAL_TAX' | 'TDS' | 'GRATUITY' | 'NPS';
  scheduled_payment_date: string;
  debit_account_number?: string;
  maker_id: string;
  ledger_references?: {
    general_ledger_code?: string;
    liability_account?: string;
    contra_account?: string;
    cost_center?: string;
    journal_voucher_ref?: string;
  };
}

export interface SettleBatchRequest {
  batch_id: string;
  bank_ref?: string;
  clearing_status?: 'PAID' | 'FAILED' | 'PARTIALLY_PAID';
  settled_by?: string;
  notes?: string;
}

export interface SettleBatchResponse {
  batch_id: string;
  batch_type: string;
  previous_status: string;
  status: 'PAID' | 'FAILED' | 'PARTIALLY_PAID';
  settled_at: string;
  settled_by: string;
  bank_ref: string | null;
  records_count: number;
  total_settled_amount: number;
  cascaded_to_other_batches: false;     // Strict guarantee
}

/* ============================================================================
 * CRITERIA 2, 3 & 12: GATEKEEPERS & PRIVILEGED SIGNED EXPORT CONTRACTS
 * ============================================================================
 */

export interface ApproveBatchSecurityRequest {
  checker_id: string;
  decision?: 'APPROVE' | 'REJECT';
  comments?: string;
  correlation_id?: string;
}

export interface PrivilegedExportRequest {
  batch_id: string;
  authorized_by: string;
  purpose: 'BANK_CLEARING_FILE' | 'STATUTORY_RETURN' | 'TREASURY_TRANSFER';
  export_format: 'CSV' | 'TXT' | 'JSON';
}

export interface PrivilegedExportResponse {
  export_job_id: string;
  batch_id: string;
  authorization_token: string;
  signature: string;
  records_count: number;
  total_amount: number;
  raw_records_accessible: true;
  unmasked_data: any[];
}

/* ============================================================================
 * CRITERIA 5 & 6: BANK FILE GENERATION & REISSUE WORKFLOW CONTRACTS
 * ============================================================================
 */

export interface GenerateBankFileRequest {
  batch_id: string;
  format?: 'CSV' | 'TXT';
  operator_id?: string;
  correlation_id?: string;
}

export interface GenerateBankFileResponse {
  file_id: string;
  version: number;
  checksum: string;
  source_batch_id: string;
  row_count: number;
  total_amount: number;
  generated_at: string;
  file_name: string;
  download_url: string;
}

export interface ReissueBankFileRequest {
  batch_id: string;
  reason: string;
  reissued_by: string;
  signature?: string;
  format?: 'CSV' | 'TXT';
}

export interface ReissueBankFileResponse {
  new_file_id: string;
  version: number;
  checksum: string;
  previous_file_id: string;
  source_batch_id: string;
  row_count: number;
  total_amount: number;
  reissued_at: string;
  reissued_by: string;
  reason: string;
}

/**
 * 12. Criterion 7: Bank Response Ingestion & Transaction Reconciliation Contracts
 */
export interface IngestBankResponseApiRequest {
  batch_id?: string;
  file_content: string;
  file_format?: 'CSV' | 'XML' | 'TXT';
  file_name?: string;
  operator_id?: string;
  organization_id?: string;
}

export interface IngestBankResponseApiResponse {
  batch_id: string;
  status: 'RECONCILING' | 'PAID' | 'FAILED' | 'PARTIALLY_SETTLED';
  total_instructions: number;
  matched_count: number;
  unmatched_count: number;
  settled_count: number;
  failed_count: number;
  open_exception_count: number;
  auto_closure_blocked: boolean;
  reconciliation_exceptions: any[];
  reconciled_at: string;
}

export interface ResolveReconciliationExceptionApiRequest {
  exception_id: string;
  action: 'MANUAL_MATCH' | 'ACCEPT_DIFFERENCE' | 'FORCE_SETTLE' | 'MARK_FAILED_FOR_RETRY' | 'WAIVE';
  resolved_by: string;
  notes: string;
  override_instruction_id?: string;
  cleared_amount_override?: number;
}

export interface ResolveReconciliationExceptionApiResponse {
  exception_id: string;
  status: 'RESOLVED' | 'WAIVED';
  resolved_by: string;
  resolved_at: string;
  action: string;
  notes: string;
  batch_id: string;
  batch_status: 'RECONCILING' | 'PAID' | 'FAILED' | 'PARTIALLY_SETTLED';
  remaining_open_exceptions: number;
}

/**
 * 13. Criteria 8, 9 & 10: Modular Statutory Compliance Pipeline Contracts
 */
export interface EsicPipelineApiRequest {
  run_id: string;
  period: string;
  payroll_records: any[];
  employee_profiles?: any[];
  options?: Record<string, any>;
}

export interface GratuityCalculateWithReceiptApiRequest {
  employee_id: string;
  date_of_joining: string;
  date_of_exit: string;
  exit_reason?: 'RESIGNATION' | 'RETIREMENT' | 'TERMINATION' | 'DEATH' | 'DISABILITY' | string;
  last_drawn_basic: number;
  last_drawn_da?: number;
  nominees?: Array<{ nominee_name: string; share_percentage: number }>;
  policy_override?: any;
}

export interface NpsValidateAndExportApiRequest {
  source_run_id: string;
  period: string;
  month_year?: string;
  records: any[];
  corporate_registration_number?: string;
  pao_or_pop_sp_code?: string;
  entity_name?: string;
  admin_user?: string;
  options?: Record<string, any>;
}

/**
 * 14. Criterion 11: Centralized Compliance Audit Logger Query Contracts
 */
export interface AuditQueryApiRequest {
  entity_type?: string;
  entity_id?: string;
  correlation_id?: string;
  from_date?: string;
  to_date?: string;
  actor_id?: string;
  actor_role?: string;
  from_state?: string;
  to_state?: string;
  rule_version_applied?: string;
  limit?: number;
  offset?: number;
}

export interface AuditQueryApiResponse {
  total: number;
  limit: number;
  offset: number;
  count: number;
  events: any[];
  timeline: any[];
}

