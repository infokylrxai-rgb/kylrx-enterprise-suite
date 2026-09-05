/**
 * ============================================================================
 * KYLRX AI ENTERPRISE HRMS - ECR FORMATTING & FILE GENERATOR
 * ============================================================================
 * Implements Section 5 of the Visual Compliance Blueprint:
 *
 * 1. Field Mapping Engine:
 *    Maps internal database fields dynamically into canonical ECR fields:
 *    - UAN                                   -> {{employee.uan}}
 *    - Member ID                             -> {{employee.pf_member_id}}
 *    - Member Name                           -> {{employee.name}}
 *    - Gross Wages                           -> {{payroll.gross_wages}}
 *    - EPF Wages                             -> {{payroll.epf_wages}}
 *    - EPS Wages                             -> {{payroll.eps_wages}}
 *    - EDLI Wages                            -> {{payroll.edli_wages}}
 *    - EE Share Remitted                     -> {{payroll.employee_pf}}
 *    - EPS Share Remitted                    -> {{payroll.eps}}
 *    - ER Share Remitted                     -> {{payroll.employer_pf}}
 *    - NCP Days                              -> {{employee.ncp_days}}
 *    - Refund of Advances                    -> {{employee.refund}}
 *    - Arrear EPF/EPS/EDLI Wages & Remit     -> {{employee.arrears}}
 *
 * 2. Delimiter File Generation:
 *    - Compiles standard EPFO delimiter-separated format (#~#)
 *    - Cleans and sanitizes names and delimiter characters
 *
 * 3. SHA-256 Checksum:
 *    - Computes cryptographic SHA-256 hash on raw file output
 *
 * 4. ComplianceReturn Persistence:
 *    - Persists metadata conforming to ComplianceReturn schema (scheme: 'EPF_ECR')
 *
 * @version 5.0.0
 * @author Kylrx AI Lead Compliance Architect
 */

import crypto from 'node:crypto';

export const ECR_RULE_VERSION = 'EPFO_ECR_FORMATTING_V5.0';
export const ECR_DELIMITER = '#~#';

/** In-memory storage for ECR ComplianceReturns */
export const inMemoryEcrComplianceReturns = new Map();

/**
 * Resets the in-memory ComplianceReturn registry
 */
export function clearEcrComplianceReturns() {
  inMemoryEcrComplianceReturns.clear();
}

/**
 * Retrieves all stored ECR compliance returns with optional filtering
 */
export function getEcrComplianceReturns(filter = {}) {
  let returns = Array.from(inMemoryEcrComplianceReturns.values());

  if (filter.period || filter.wage_month) {
    const targetPeriod = filter.period || filter.wage_month;
    returns = returns.filter((r) => r.period === targetPeriod || r.wage_month === targetPeriod);
  }
  if (filter.status) {
    returns = returns.filter((r) => r.status === filter.status);
  }
  if (filter.establishment_id) {
    returns = returns.filter((r) => r.establishment_id === filter.establishment_id);
  }

  return returns;
}

/**
 * Retrieves a single ECR compliance return by its return_id
 */
export function getEcrComplianceReturnById(returnId) {
  return inMemoryEcrComplianceReturns.get(String(returnId).trim()) || null;
}

/* ============================================================================
 * 1. DYNAMIC FIELD MAPPING ENGINE
 * ============================================================================
 */

export class FieldMappingEngine {
  /**
   * Evaluates template string or field selector against context objects
   * Example: evaluateExpression('{{employee.uan}}', { employee, payroll })
   */
  static evaluateExpression(expr, context = {}) {
    if (!expr || typeof expr !== 'string') return '';
    const match = expr.match(/^\{\{([a-zA-Z0-9_.]+)\}\}$/);
    if (!match) return expr;

    const path = match[1].split('.');
    let current = context;
    for (const key of path) {
      if (current === undefined || current === null) return undefined;
      current = current[key];
    }
    return current;
  }

  /**
   * Canonical field mapping specifications
   */
  static CANONICAL_MAPPINGS = Object.freeze({
    uan: '{{employee.uan}}',
    pf_member_id: '{{employee.pf_member_id}}',
    name: '{{employee.name}}',
    gross_wages: '{{payroll.gross_wages}}',
    epf_wages: '{{payroll.epf_wages}}',
    eps_wages: '{{payroll.eps_wages}}',
    edli_wages: '{{payroll.edli_wages}}',
    employee_pf: '{{payroll.employee_pf}}',
    eps: '{{payroll.eps}}',
    employer_pf: '{{payroll.employer_pf}}',
    ncp_days: '{{employee.ncp_days}}',
    refund: '{{employee.refund}}',
    arrears: '{{employee.arrears}}',
  });

  /**
   * Maps internal database employee & payroll records into canonical ECR entity
   */
  static mapRecord(employeeData = {}, payrollData = {}) {
    // Normalization context
    const employee = {
      uan: String(employeeData.uan || employeeData.pf_uan || '').trim(),
      pf_member_id: String(employeeData.pf_member_id || employeeData.member_id || '').trim(),
      name: String(employeeData.name || employeeData.employee_name || employeeData.fullName || 'Member').trim(),
      ncp_days: Number(employeeData.ncp_days ?? payrollData.ncp_days ?? 0),
      refund: Number(employeeData.refund ?? employeeData.adv_refund ?? payrollData.adv_refund ?? 0),
      arrears: employeeData.arrears || payrollData.arrears || null,
      ...employeeData,
    };

    const basic = Number(payrollData.basic || payrollData.last_drawn_basic || 0);
    const da = Number(payrollData.da || payrollData.last_drawn_da || 0);
    const gross = Number(payrollData.gross_wages ?? payrollData.gross ?? payrollData.gross_salary ?? (basic + da));

    const epfWages = Number(payrollData.epf_wages ?? Math.min(basic + da > 0 ? basic + da : gross, 15000));
    const epsWages = Number(payrollData.eps_wages ?? (employeeData.eps_applicable !== false ? Math.min(basic + da > 0 ? basic + da : gross, 15000) : 0));
    const edliWages = Number(payrollData.edli_wages ?? Math.min(basic + da > 0 ? basic + da : gross, 15000));

    const eePf = Number(payrollData.employee_pf ?? payrollData.ee_share ?? Math.round(epfWages * 0.12));
    const eps = Number(payrollData.eps ?? payrollData.eps_share ?? (epsWages > 0 ? Math.min(1250, Math.round(epsWages * 0.0833)) : 0));
    const erPf = Number(payrollData.employer_pf ?? payrollData.er_epf_share ?? (eePf - eps));

    const payroll = {
      gross_wages: gross,
      epf_wages: epfWages,
      eps_wages: epsWages,
      edli_wages: edliWages,
      employee_pf: eePf,
      eps: eps,
      employer_pf: erPf,
      ...payrollData,
    };

    const context = { employee, payroll };

    // Dynamic field extraction using blueprint canonical mappings
    const mapped = {
      uan: String(this.evaluateExpression(this.CANONICAL_MAPPINGS.uan, context) || employee.uan).trim(),
      pf_member_id: String(this.evaluateExpression(this.CANONICAL_MAPPINGS.pf_member_id, context) || employee.pf_member_id).trim(),
      name: String(this.evaluateExpression(this.CANONICAL_MAPPINGS.name, context) || employee.name).replace(/[#~]/g, '').trim(),
      gross_wages: Math.round(Number(this.evaluateExpression(this.CANONICAL_MAPPINGS.gross_wages, context) ?? gross)),
      epf_wages: Math.round(Number(this.evaluateExpression(this.CANONICAL_MAPPINGS.epf_wages, context) ?? epfWages)),
      eps_wages: Math.round(Number(this.evaluateExpression(this.CANONICAL_MAPPINGS.eps_wages, context) ?? epsWages)),
      edli_wages: Math.round(Number(this.evaluateExpression(this.CANONICAL_MAPPINGS.edli_wages, context) ?? edliWages)),
      employee_pf: Math.round(Number(this.evaluateExpression(this.CANONICAL_MAPPINGS.employee_pf, context) ?? eePf)),
      eps: Math.round(Number(this.evaluateExpression(this.CANONICAL_MAPPINGS.eps, context) ?? eps)),
      employer_pf: Math.round(Number(this.evaluateExpression(this.CANONICAL_MAPPINGS.employer_pf, context) ?? erPf)),
      ncp_days: Math.max(0, Number(this.evaluateExpression(this.CANONICAL_MAPPINGS.ncp_days, context) ?? 0)),
      refund: Math.max(0, Number(this.evaluateExpression(this.CANONICAL_MAPPINGS.refund, context) ?? 0)),
      arrears: this.evaluateExpression(this.CANONICAL_MAPPINGS.arrears, context),
    };

    return mapped;
  }
}

/* ============================================================================
 * 2. ECR FORMATTING & DELIMITER GENERATION ENGINE
 * ============================================================================
 */

export class EcrFileGenerator {
  constructor(options = {}) {
    this.delimiter = options.delimiter || ECR_DELIMITER;
    this.firestoreDb = options.firestoreDb || null;
  }

  /**
   * Compiles mapped records into the official EPFO #~# delimiter format
   * Standard format:
   * UAN#~#MEMBER_NAME#~#GROSS#~#EPF_WAGES#~#EPS_WAGES#~#EDLI_WAGES#~#EE_SHARE#~#EPS_SHARE#~#ER_SHARE#~#NCP_DAYS#~#ADV_REFUND
   * With Arrears (if present):
   * ...#~#ARREAR_EPF#~#ARREAR_EE#~#ARREAR_ER#~#ARREAR_EPS
   */
  compileEcrRow(mappedRecord) {
    const fields = [
      mappedRecord.uan,
      mappedRecord.name,
      mappedRecord.gross_wages,
      mappedRecord.epf_wages,
      mappedRecord.eps_wages,
      mappedRecord.edli_wages,
      mappedRecord.employee_pf,
      mappedRecord.eps,
      mappedRecord.employer_pf,
      mappedRecord.ncp_days,
      mappedRecord.refund,
    ];

    // Optional Arrear EPF/EPS/EDLI Wages & Remittances
    if (mappedRecord.arrears && typeof mappedRecord.arrears === 'object') {
      const arrEpf = Math.round(Number(mappedRecord.arrears.arrear_epf_wages || mappedRecord.arrears.epf_wages || 0));
      const arrEe = Math.round(Number(mappedRecord.arrears.arrear_ee_share || mappedRecord.arrears.ee_share || 0));
      const arrEr = Math.round(Number(mappedRecord.arrears.arrear_er_share || mappedRecord.arrears.er_share || 0));
      const arrEps = Math.round(Number(mappedRecord.arrears.arrear_eps_share || mappedRecord.arrears.eps_share || 0));

      fields.push(arrEpf, arrEe, arrEr, arrEps);
    } else if (mappedRecord.arrears && typeof mappedRecord.arrears === 'string' && mappedRecord.arrears.trim()) {
      fields.push(mappedRecord.arrears.trim());
    }

    return fields.join(this.delimiter);
  }

  /**
   * Core generator method: Maps records, compiles delimited text,
   * calculates SHA-256 checksum, and persists ComplianceReturn.
   */
  generateEcrReturn(params = {}) {
    const period = String(params.period || params.wage_month || '2026-09');
    const sanitizedPeriod = period.replace(/[^a-zA-Z0-9]/g, '_');
    const establishmentId = String(params.establishment_id || 'EST001').trim();
    const sourcePayrollRunId = params.source_payroll_run_id || params.payroll_run_id || `RUN_${Date.now()}`;
    const adminId = params.admin_id || params.executed_by || 'system_compliance_officer';
    const rawRecords = params.records || params.payroll_records || params.employees || [];

    const mappedRecords = [];
    const lines = [];

    let totalStatutoryWages = 0;
    let totalEmployeePf = 0;
    let totalEps = 0;
    let totalEmployerPf = 0;

    for (const item of rawRecords) {
      const employeeData = item.employee || item;
      const payrollData = item.payroll || item;

      // Skip non-applicable or defective if flag present
      if (employeeData.pf_applicable === false) continue;

      const mapped = FieldMappingEngine.mapRecord(employeeData, payrollData);
      mappedRecords.push(mapped);

      const rowLine = this.compileEcrRow(mapped);
      lines.push(rowLine);

      totalStatutoryWages += mapped.epf_wages;
      totalEmployeePf += mapped.employee_pf;
      totalEps += mapped.eps;
      totalEmployerPf += mapped.employer_pf;
    }

    const rawContent = lines.join('\r\n');
    const checksumSha256 = crypto.createHash('sha256').update(rawContent, 'utf8').digest('hex');

    const fileName = `EPFO_ECR_${establishmentId}_${sanitizedPeriod}.txt`;
    const returnId = params.return_id || `ecr_ret_${sanitizedPeriod}_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`;
    const totalEmployerLiability = totalEmployerPf + totalEps;
    const totalPayableChallan = totalEmployeePf + totalEmployerLiability;

    // 4. Construct ComplianceReturn (scheme: 'EPF_ECR')
    const generationTimestamp = new Date().toISOString();
    const complianceReturn = {
      return_id: returnId,
      organization_id: params.organization_id || 'ORG_KYLRX_ENT',
      payroll_run_id: sourcePayrollRunId,
      statutory_head: 'PF',
      scheme: 'EPF_ECR',
      period,
      wage_month: period,
      policy_version_applied: 4,
      rule_version: ECR_RULE_VERSION,
      status: 'GENERATED',
      identifier_type: 'UAN',
      establishment_id: establishmentId,

      // Metadata properties specified in blueprint:
      file_hash: checksumSha256,
      generation_timestamp: generationTimestamp,
      row_count: mappedRecords.length,
      total_wages: totalStatutoryWages,
      total_contributions: totalPayableChallan,

      summary: {
        total_eligible_headcount: mappedRecords.length,
        total_statutory_wages: totalStatutoryWages,
        total_employee_deductions: totalEmployeePf,
        total_employer_liability: totalEmployerLiability,
        total_payable_challan: totalPayableChallan,
        total_contributions: totalPayableChallan,
      },
      export_artifact: {
        file_type: 'ECR_TXT',
        file_name: fileName,
        storage_path: `/compliance/ecr/${fileName}`,
        checksum_sha256: checksumSha256,
        file_hash: checksumSha256,
        size_bytes: Buffer.byteLength(rawContent, 'utf8'),
        generated_at: generationTimestamp,
      },
      created_at: generationTimestamp,
      created_by: adminId,
    };

    // Persist to in-memory store
    if (params.persist !== false) {
      inMemoryEcrComplianceReturns.set(returnId, complianceReturn);

      if (this.firestoreDb && typeof this.firestoreDb.collection === 'function') {
        try {
          const res = this.firestoreDb.collection('compliance_returns').doc(returnId).set(complianceReturn, { merge: true });
          if (res && typeof res.catch === 'function') res.catch(() => {});
        } catch (e) {
          // Graceful fallback
        }
      }
    }

    return {
      success: true,
      file_name: fileName,
      file_type: 'ECR_TXT',
      content: rawContent,
      checksum_sha256: checksumSha256,
      size_bytes: Buffer.byteLength(rawContent, 'utf8'),
      row_count: mappedRecords.length,
      compliance_return: complianceReturn,
      mapped_records: mappedRecords,
    };
  }
}

// Global Singleton Instance
export const globalEcrFileGenerator = new EcrFileGenerator();
