/**
 * ============================================================================
 * KYLRX AI ENTERPRISE HRMS - CANONICAL VALIDATION ERROR CATALOG & PIPELINE TYPES
 * ============================================================================
 * Single Shared Vocabulary across UI, API, Services, and Audit Records.
 * Strict TypeScript Models for the 9-Step Deterministic Validation Pipeline.
 *
 * @version 2.0.0
 * @author Kylrx AI Principal Backend Engineering Team
 */

export type ErrorSeverityType = 'BLOCK' | 'WARN' | 'INFO';

export enum ErrorSeverity {
  BLOCK = 'BLOCK',
  WARN = 'WARN',
  INFO = 'INFO',
}

export type ErrorCodeType =
  | 'EMP021'
  | 'EMP037'
  | 'EMP052'
  | 'DUP001'
  | 'VAL001'
  | 'WARN001'
  | 'LEDGER_MISMATCH';

export interface ErrorCatalogEntry {
  code: ErrorCodeType;
  severity: ErrorSeverityType;
  title: string;
  category: 'STRUCTURAL' | 'POLICY' | 'CROSS_ROW' | 'ELIGIBILITY' | 'PROFILE' | 'RECONCILIATION';
  description: string;
  resolutionStrategy: string;
}

export const CANONICAL_ERROR_CATALOG: Record<ErrorCodeType, ErrorCatalogEntry> = Object.freeze({
  EMP021: {
    code: 'EMP021',
    severity: ErrorSeverity.BLOCK,
    category: 'STRUCTURAL',
    title: 'Invalid IFSC / Bank Routing Value',
    description: 'Bank routing code does not match RBI canonical format (/^[A-Z]{4}0[A-Z0-9]{6}$/).',
    resolutionStrategy: 'Update employee bank master record with a valid 11-character alphanumeric IFSC code.',
  },
  EMP037: {
    code: 'EMP037',
    severity: ErrorSeverity.BLOCK,
    category: 'STRUCTURAL',
    title: 'Invalid or Missing Bank Account Number',
    description: 'Bank account number is missing, non-numeric, or length is less than 9 digits (or exceeds 18 digits).',
    resolutionStrategy: 'Provide a valid 9 to 18 digit numeric bank account number in employee profile.',
  },
  EMP052: {
    code: 'EMP052',
    severity: ErrorSeverity.BLOCK,
    category: 'POLICY',
    title: 'Negative or Invalid Payment Amount',
    description: 'Net payable amount is zero, negative, or NaN.',
    resolutionStrategy: 'Adjust earnings or deductions in payroll calculation to guarantee positive net payout.',
  },
  DUP001: {
    code: 'DUP001',
    severity: ErrorSeverity.BLOCK,
    category: 'CROSS_ROW',
    title: 'Duplicate Payment Instruction',
    description: 'Duplicate employee ID, bank account, or payment reference detected in active disbursement batch.',
    resolutionStrategy: 'Remove or consolidate duplicate records to prevent double disbursement.',
  },
  VAL001: {
    code: 'VAL001',
    severity: ErrorSeverity.BLOCK,
    category: 'ELIGIBILITY',
    title: 'Statutory Policy, Wage Ceiling, or Effective Date Violation',
    description: 'Employee not eligible for scheme based on statutory policy, wage ceiling, missing mandatory identifier, or outside effective date range.',
    resolutionStrategy: 'Update effective date window, link mandatory statutory identifier (UAN/IP/PRAN), or adjust scheme eligibility.',
  },
  WARN001: {
    code: 'WARN001',
    severity: ErrorSeverity.WARN,
    category: 'PROFILE',
    title: 'Non-Blocking Profile Warning',
    description: 'Employee profile is missing non-critical attributes requiring policy acknowledgment (e.g., email address, emergency contact).',
    resolutionStrategy: 'Acknowledge warning or update optional employee communication attributes.',
  },
  LEDGER_MISMATCH: {
    code: 'LEDGER_MISMATCH',
    severity: ErrorSeverity.BLOCK,
    category: 'RECONCILIATION',
    title: 'Frozen Source Ledger Disparity',
    description: 'Calculated batch sum does not match authoritative immutable payroll ledger.',
    resolutionStrategy: 'Re-sync batch records with authoritative immutable payroll run calculation.',
  },
});

export interface ValidationIssue {
  issue_id: string;
  batch_id: string;
  employee_id: string;
  employee_name?: string;
  code: ErrorCodeType;
  title: string;
  severity: ErrorSeverityType;
  category?: string;
  field: string | null;
  actual_value?: any;
  message: string;
  suggested_fix: string;
  resolved: boolean;
  resolved_at: string | null;
  resolved_by: string | null;
  resolution_notes?: string | null;
  created_at: string;
}

export interface PipelineStepTrace {
  step: number;
  name: string;
  status: 'STARTED' | 'PASSED' | 'FAILED' | 'SKIPPED';
  timestamp: string;
  details?: Record<string, any>;
}

export interface BatchCalculatedAggregates {
  record_count: number;
  total_gross: number;
  total_deductions: number;
  total_net: number;
  total_contributions: number;
}

export interface DeterministicValidationResult {
  batch_id: string;
  status: 'VALIDATED' | 'FAILED';
  validation_status: 'VALIDATED' | 'VALIDATION_FAILED';
  can_generate_bank_file: boolean;
  is_blocked: boolean;
  issues: ValidationIssue[];
  blocking_issues: ValidationIssue[];
  warning_issues: ValidationIssue[];
  unresolved_blocking_count: number;
  calculated_aggregates: BatchCalculatedAggregates;
  execution_trace: PipelineStepTrace[];
  validated_at: string;
  validated_by: string;
}
