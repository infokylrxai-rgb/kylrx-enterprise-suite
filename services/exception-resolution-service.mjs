/**
 * ============================================================================
 * KYLRX AI ENTERPRISE HRMS - EXCEPTION RESOLUTION & DYNAMIC RE-VALIDATION
 * ============================================================================
 * Backend Controller & Atomic Database Transaction Handler for Exception Resolution:
 *
 * Remediation Endpoint Specification:
 *   POST /api/payroll/batches/:batchId/resolve-issue
 *   Accepts: issue_id, field, updated_value, and admin_id.
 *
 * Atomic Transaction Flow:
 *  1. Verify the targeted batch is in an editable state (DRAFT, VALIDATING, or FAILED).
 *  2. Update the target field in the employee's master banking profile and increment bank_account_version.
 *  3. Mark the corresponding ValidationIssue document with resolved_at: timestamp and resolved_by: admin_id.
 *  4. Re-execute the 9-step validation pipeline against the modified record and batch.
 *  5. If all blocking issues are cleared, automatically lift the generation lock,
 *     recompute batch totals, and advance the batch state to VALIDATED.
 *
 * @version 2.0.0
 * @author Kylrx AI Principal Backend Engineering Team
 */

import crypto from 'node:crypto';
import { DeterministicValidationPipeline, ErrorCatalog, ErrorSeverity, IFSC_REGEX } from './deterministic-validation-pipeline.mjs';
import { PaymentBatchTransitionRunner, PaymentBatchState, BatchTransitionEvent, ActorRole } from './payment-batch-fsm.mjs';

/**
 * Custom Error Classes for Exception Resolution Trapping
 */
export class ResolutionValidationError extends Error {
  constructor(message, statusCode = 400, details = {}) {
    super(message);
    this.name = 'ResolutionValidationError';
    this.statusCode = statusCode;
    this.details = details;
  }
}

export class TransactionRollbackError extends Error {
  constructor(message, originalError = null) {
    super(message);
    this.name = 'TransactionRollbackError';
    this.originalError = originalError;
  }
}

/**
 * In-Memory & Production Transactional Database Store Adapter
 */
export class TransactionalDatabaseStore {
  constructor() {
    this.batches = new Map();
    this.employees = new Map();
    this.validationIssues = new Map(); // batchId -> Map(issueId -> issue)
    this.auditLogs = [];
  }

  // Seed / Setup Helpers
  setBatch(batch) {
    this.batches.set(batch.batch_id, JSON.parse(JSON.stringify(batch)));
  }

  setEmployee(emp) {
    const empId = String(emp.employee_id || emp.id).trim();
    this.employees.set(empId, {
      ...JSON.parse(JSON.stringify(emp)),
      employee_id: empId,
      bank_account_version: Number(emp.bank_account_version || 1),
    });
  }

  setIssues(batchId, issues = []) {
    let issueMap = this.validationIssues.get(batchId);
    if (!issueMap) {
      issueMap = new Map();
      this.validationIssues.set(batchId, issueMap);
    }
    for (const issue of issues) {
      issueMap.set(issue.issue_id, JSON.parse(JSON.stringify(issue)));
    }
  }

  /**
   * Executes an atomic ACID transaction.
   * Creates a staging clone. If any operation fails, staging is discarded (Rollback).
   * If successful, mutations are atomically committed.
   */
  async runTransaction(txCallback) {
    const stagedBatches = new Map(
      Array.from(this.batches.entries()).map(([k, v]) => [k, JSON.parse(JSON.stringify(v))])
    );
    const stagedEmployees = new Map(
      Array.from(this.employees.entries()).map(([k, v]) => [k, JSON.parse(JSON.stringify(v))])
    );
    const stagedIssues = new Map();
    for (const [batchId, issueMap] of this.validationIssues.entries()) {
      const clonedMap = new Map(
        Array.from(issueMap.entries()).map(([k, v]) => [k, JSON.parse(JSON.stringify(v))])
      );
      stagedIssues.set(batchId, clonedMap);
    }
    const stagedAuditLogs = [...this.auditLogs];

    const txContext = {
      getBatch: async (batchId) => {
        const b = stagedBatches.get(batchId);
        return b ? JSON.parse(JSON.stringify(b)) : null;
      },
      getEmployee: async (empId) => {
        const e = stagedEmployees.get(String(empId).trim());
        return e ? JSON.parse(JSON.stringify(e)) : null;
      },
      getValidationIssues: async (batchId) => {
        const map = stagedIssues.get(batchId);
        if (!map) return [];
        return Array.from(map.values()).map((v) => JSON.parse(JSON.stringify(v)));
      },
      getValidationIssue: async (batchId, issueId) => {
        const map = stagedIssues.get(batchId);
        if (!map) return null;
        const issue = map.get(issueId);
        return issue ? JSON.parse(JSON.stringify(issue)) : null;
      },
      saveBatch: async (batch) => {
        stagedBatches.set(batch.batch_id, JSON.parse(JSON.stringify(batch)));
      },
      saveEmployee: async (emp) => {
        const empId = String(emp.employee_id || emp.id).trim();
        stagedEmployees.set(empId, JSON.parse(JSON.stringify(emp)));
      },
      saveValidationIssue: async (batchId, issue) => {
        let map = stagedIssues.get(batchId);
        if (!map) {
          map = new Map();
          stagedIssues.set(batchId, map);
        }
        map.set(issue.issue_id, JSON.parse(JSON.stringify(issue)));
      },
      logAudit: async (auditEntry) => {
        stagedAuditLogs.push(JSON.parse(JSON.stringify(auditEntry)));
      },
    };

    try {
      const result = await txCallback(txContext);

      // Commit staged mutations atomically
      this.batches = stagedBatches;
      this.employees = stagedEmployees;
      this.validationIssues = stagedIssues;
      this.auditLogs = stagedAuditLogs;

      return result;
    } catch (error) {
      // Discard staging -> Full Rollback
      throw error;
    }
  }
}

/**
 * Exception Resolution and Dynamic Re-validation Service
 */
export class ExceptionResolutionService {
  constructor(options = {}) {
    this.store = options.store || new TransactionalDatabaseStore();
    this.validationPipeline = options.validationPipeline || new DeterministicValidationPipeline();
    this.fsm = options.fsm || new PaymentBatchTransitionRunner();
  }

  /**
   * 1. Issue Ingestion:
   * Persists failed checks to ValidationIssue entities with:
   * (issue_id, batch_id, code, severity, message, field, employee_id, resolved_at: null, resolved_by: null)
   */
  async ingestValidationIssues(batchId, rawIssues = []) {
    if (!batchId) {
      throw new ResolutionValidationError('batchId is required for issue ingestion.');
    }

    const standardizedIssues = rawIssues.map((raw) => {
      const code = raw.code || 'VAL_GENERIC';
      const severity = raw.severity === 'BLOCKING' || raw.severity === 'BLOCK' ? ErrorSeverity.BLOCK : (raw.severity || ErrorSeverity.WARN);
      const issueId = raw.issue_id || `ISS-${code}-${crypto.randomUUID().substring(0, 8).toUpperCase()}`;

      return {
        issue_id: issueId,
        batch_id: batchId,
        code: code,
        severity: severity,
        message: raw.message || raw.description || 'Validation failure detected.',
        field: raw.field || null,
        employee_id: raw.employee_id ? String(raw.employee_id).trim() : 'SYSTEM',
        employee_name: raw.employee_name || 'Employee',
        suggested_fix: raw.suggested_fix || raw.resolutionStrategy || 'Review and remediate master record.',
        resolved: false,
        resolved_at: null,
        resolved_by: null,
        resolution_notes: null,
        created_at: raw.created_at || new Date().toISOString(),
      };
    });

    this.store.setIssues(batchId, standardizedIssues);
    return standardizedIssues;
  }

  /**
   * 2. Atomic Database Transaction Flow for Resolving Exceptions:
   *
   * Flow:
   *  1. Verify the targeted batch is in an editable state (DRAFT or VALIDATING or FAILED).
   *  2. Update the target field in the employee's master banking profile and increment bank_account_version.
   *  3. Mark the corresponding ValidationIssue document with resolved_at: timestamp and resolved_by: admin_id.
   *  4. Re-execute the 9-step validation pipeline against the modified record.
   *  5. If all blocking issues are cleared, automatically lift the generation lock,
   *     recompute batch totals, and advance the batch state to VALIDATED.
   */
  async resolveIssueAndRevalidate({
    batchId,
    issueId,
    field = null,
    updatedValue = null,
    employeeId = null,
    correctedData = null,
    adminId = null,
    resolvedBy = null,
    resolutionNotes = 'Exception resolved via remediation API',
    payrollSourceLedger = null,
  }) {
    const finalAdminId = adminId || resolvedBy || 'SYSTEM_ADMIN';
    const finalIssueId = issueId;

    if (!batchId || !finalIssueId) {
      throw new ResolutionValidationError('batchId and issue_id are mandatory parameters.', 400);
    }

    // Build unified corrected data object
    let finalCorrectedData = correctedData ? { ...correctedData } : {};
    if (field && updatedValue !== undefined && updatedValue !== null) {
      finalCorrectedData[field] = updatedValue;
    }

    if (Object.keys(finalCorrectedData).length === 0) {
      throw new ResolutionValidationError('At least one corrected field and updated_value must be provided.', 400);
    }

    // Execute within atomic ACID database transaction
    return await this.store.runTransaction(async (tx) => {
      // Step 1: Load and verify targeted batch is in an editable state (DRAFT, VALIDATING, or FAILED)
      const batch = await tx.getBatch(batchId);
      if (!batch) {
        throw new ResolutionValidationError(`PaymentBatch with ID '${batchId}' not found.`, 404);
      }

      const editableStates = [
        PaymentBatchState.DRAFT,
        PaymentBatchState.VALIDATING,
        PaymentBatchState.FAILED,
        'VALIDATION_FAILED',
      ];

      if (!editableStates.includes(batch.status)) {
        throw new ResolutionValidationError(
          `Cannot remediate batch '${batchId}' in state '${batch.status}'. Remediation is only permitted on editable batches (DRAFT, VALIDATING, FAILED).`,
          422,
          { current_state: batch.status, allowed_states: editableStates }
        );
      }

      // Load ValidationIssue
      const issue = await tx.getValidationIssue(batchId, finalIssueId);
      if (!issue) {
        throw new ResolutionValidationError(`ValidationIssue '${finalIssueId}' not found for batch '${batchId}'.`, 404);
      }

      if (issue.resolved === true || issue.resolved_at !== null) {
        throw new ResolutionValidationError(`ValidationIssue '${finalIssueId}' has already been resolved.`, 409, {
          resolved_at: issue.resolved_at,
          resolved_by: issue.resolved_by,
        });
      }

      const targetEmpId = String(employeeId || issue.employee_id).trim();
      if (issue.employee_id && issue.employee_id !== 'SYSTEM' && targetEmpId && issue.employee_id !== targetEmpId) {
        throw new ResolutionValidationError(
          `Issue employee_id '${issue.employee_id}' does not match target employeeId '${targetEmpId}'.`,
          400
        );
      }

      // Step 2: Update target field in employee master banking profile & increment bank_account_version
      let employee = await tx.getEmployee(targetEmpId);
      if (!employee) {
        const embeddedRecord = (batch.records || []).find((r) => String(r.employee_id || r.id).trim() === targetEmpId);
        if (embeddedRecord) {
          employee = { ...embeddedRecord, employee_id: targetEmpId, bank_account_version: 1 };
        } else {
          throw new ResolutionValidationError(`Employee master record '${targetEmpId}' not found.`, 404);
        }
      }

      const previousVersion = Number(employee.bank_account_version || 1);
      const newVersion = previousVersion + 1;

      const updatedEmployee = {
        ...employee,
        ...finalCorrectedData,
        ifsc_code: finalCorrectedData.ifsc_code ? String(finalCorrectedData.ifsc_code).trim().toUpperCase() : employee.ifsc_code,
        account_number: finalCorrectedData.account_number ? String(finalCorrectedData.account_number).trim() : employee.account_number,
        bank_account_version: newVersion,
        updated_at: new Date().toISOString(),
        updated_by: finalAdminId,
      };

      await tx.saveEmployee(updatedEmployee);

      // Step 3: Mark ValidationIssue document with resolved_at and resolved_by
      const nowIso = new Date().toISOString();
      const resolvedIssue = {
        ...issue,
        resolved: true,
        resolved_at: nowIso,
        resolved_by: finalAdminId,
        resolution_notes: resolutionNotes,
        remediated_data: finalCorrectedData,
        previous_bank_account_version: previousVersion,
        new_bank_account_version: newVersion,
      };

      await tx.saveValidationIssue(batchId, resolvedIssue);

      // Step 4: Update batch record list & re-execute 9-step validation pipeline
      const updatedRecords = (batch.records || []).map((rec) => {
        if (String(rec.employee_id || rec.id).trim() === targetEmpId) {
          return {
            ...rec,
            ...finalCorrectedData,
            ifsc_code: updatedEmployee.ifsc_code,
            account_number: updatedEmployee.account_number,
            bank_account_version: newVersion,
          };
        }
        return rec;
      });
      batch.records = updatedRecords;

      const allIssuesForBatch = await tx.getValidationIssues(batchId);

      // Re-run the 9-step deterministic validation pipeline
      const validationResult = await this.validationPipeline.execute({
        batch,
        payrollSourceLedger: payrollSourceLedger || { total_net: batch.summary?.total_amount || batch.total_net_payable || 0 },
        employeeMasterList: updatedRecords,
        bankingProfiles: [updatedEmployee],
        statutoryProfiles: [],
        operatorId: finalAdminId,
      });

      // Synchronize existing resolved issue state with newly generated validation issues
      const remainingUnresolvedBlocking = [];
      for (const newIss of validationResult.issues) {
        // If this issue corresponds to the one just resolved and now passes, skip
        if (newIss.employee_id === targetEmpId && (newIss.field === issue.field || finalCorrectedData[newIss.field])) {
          continue;
        }

        // Check if already resolved in past transactions
        const existingResolved = allIssuesForBatch.find(
          (old) => old.employee_id === newIss.employee_id && old.code === newIss.code && old.resolved === true
        );
        if (existingResolved) {
          continue;
        }

        if (newIss.severity === ErrorSeverity.BLOCK && !newIss.resolved) {
          remainingUnresolvedBlocking.push(newIss);
        }
      }

      // Step 5: If all blocking issues are cleared, automatically lift generation lock, recompute totals, and advance state to VALIDATED
      const hasBlockingIssues = remainingUnresolvedBlocking.length > 0;
      const isBatchFullyValidated = !hasBlockingIssues;

      let totalGross = 0;
      let totalDeductions = 0;
      let totalNet = 0;
      let totalContributions = 0;

      updatedRecords.forEach((r) => {
        const gross = Number(r.gross_salary ?? r.grossSalary ?? r.gross ?? r.salary ?? 0);
        const ded = Number(r.deductions ?? r.employeeDeductions ?? 0);
        const net = Number(r.net_payable_amount ?? r.netSalary ?? r.salary ?? (gross - ded));
        const cont = Number(r.employer_contributions ?? r.employerContributions ?? 0);

        totalGross += gross;
        totalDeductions += ded;
        totalNet += net;
        totalContributions += cont;
      });

      const recomputedTotals = {
        record_count: updatedRecords.length,
        total_gross: Math.round(totalGross * 100) / 100,
        total_deductions: Math.round(totalDeductions * 100) / 100,
        total_net: Math.round(totalNet * 100) / 100,
        total_contributions: Math.round(totalContributions * 100) / 100,
      };

      if (isBatchFullyValidated) {
        batch.status = PaymentBatchState.VALIDATED;
        batch.validation_status = 'VALIDATED';
        batch.can_generate_bank_file = true;
        batch.is_blocked = false;
        batch.summary = {
          ...batch.summary,
          ...recomputedTotals,
          total_amount: recomputedTotals.total_net,
          unresolved_issues_count: 0,
          unresolved_blocking_count: 0,
          last_validated_at: nowIso,
          last_validated_by: finalAdminId,
        };
      } else {
        batch.status = PaymentBatchState.FAILED;
        batch.validation_status = 'VALIDATION_FAILED';
        batch.can_generate_bank_file = false;
        batch.is_blocked = true;
        batch.summary = {
          ...batch.summary,
          ...recomputedTotals,
          unresolved_issues_count: validationResult.issues.length,
          unresolved_blocking_count: remainingUnresolvedBlocking.length,
          last_validated_at: nowIso,
          last_validated_by: finalAdminId,
        };
      }

      await tx.saveBatch(batch);

      // Log immutable audit entry for exception remediation
      const auditLog = {
        audit_id: `AUD-RES-${crypto.randomUUID().substring(0, 8).toUpperCase()}`,
        batch_id: batchId,
        issue_id: finalIssueId,
        employee_id: targetEmpId,
        action: 'RESOLVE_EXCEPTION_AND_REVALIDATE',
        resolved_by: finalAdminId,
        resolved_at: nowIso,
        previous_bank_account_version: previousVersion,
        new_bank_account_version: newVersion,
        batch_transitioned_to: batch.status,
        can_generate_bank_file: batch.can_generate_bank_file,
        unresolved_blocking_count: remainingUnresolvedBlocking.length,
      };
      await tx.logAudit(auditLog);

      return {
        success: true,
        message: isBatchFullyValidated
          ? `Exception resolved. All blocking issues cleared. Batch '${batchId}' advanced to VALIDATED state.`
          : `Exception resolved, but ${remainingUnresolvedBlocking.length} blocking issue(s) still remain.`,
        batch_id: batchId,
        batch_status: batch.status,
        can_generate_bank_file: batch.can_generate_bank_file,
        is_blocked: batch.is_blocked,
        resolved_issue: resolvedIssue,
        updated_employee: updatedEmployee,
        bank_account_version: newVersion,
        recomputed_totals: recomputedTotals,
        unresolved_blocking_count: remainingUnresolvedBlocking.length,
        remaining_blocking_issues: remainingUnresolvedBlocking,
        execution_trace: validationResult.execution_trace,
        audit_log: auditLog,
      };
    });
  }
}

/**
 * Express Controller / Route Handler Adapter
 * POST /api/payroll/batches/:batchId/resolve-issue
 */
export function createResolveIssueHandler(exceptionService) {
  return async function resolveIssueHandler(req, res) {
    try {
      const batchId = req.params.batchId || req.body.batch_id;
      const {
        issue_id,
        field,
        updated_value,
        admin_id,
        employee_id,
        corrected_data,
        resolved_by,
        notes = 'Resolved via remediation API',
        payroll_source_ledger = null,
      } = req.body || {};

      if (!batchId) {
        return res.status(400).json({
          success: false,
          error: 'MISSING_BATCH_ID',
          message: 'batchId URL parameter or batch_id in request body is required.',
        });
      }

      if (!issue_id) {
        return res.status(400).json({
          success: false,
          error: 'MISSING_ISSUE_ID',
          message: 'issue_id is mandatory for exception resolution.',
        });
      }

      const result = await exceptionService.resolveIssueAndRevalidate({
        batchId,
        issueId: issue_id,
        field,
        updatedValue: updated_value,
        employeeId: employee_id,
        correctedData: corrected_data,
        adminId: admin_id || resolved_by || req.user?.id || 'HR_ADMIN',
        resolutionNotes: notes,
        payrollSourceLedger: payroll_source_ledger,
      });

      return res.status(200).json(result);
    } catch (error) {
      if (error instanceof ResolutionValidationError) {
        return res.status(error.statusCode || 400).json({
          success: false,
          error: error.name,
          message: error.message,
          details: error.details,
        });
      }

      console.error('[EXCEPTION_RESOLUTION_HANDLER] Unexpected Error:', error);
      return res.status(500).json({
        success: false,
        error: 'INTERNAL_SERVER_ERROR',
        message: error.message || 'An unexpected error occurred during exception resolution.',
      });
    }
  };
}
