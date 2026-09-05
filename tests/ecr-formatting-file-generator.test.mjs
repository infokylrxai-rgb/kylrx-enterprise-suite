/**
 * ============================================================================
 * KYLRX AI ENTERPRISE HRMS - SECTION 5: ECR FORMATTING & GENERATOR TESTS
 * ============================================================================
 * Validates Section 5 of the Visual Compliance Blueprint:
 *
 * 1. Field Mapping Engine:
 *    - Maps internal database fields dynamically into canonical ECR fields:
 *      UAN $\rightarrow$ {{employee.uan}}
 *      Member ID $\rightarrow$ {{employee.pf_member_id}}
 *      Member Name $\rightarrow$ {{employee.name}}
 *      Gross Wages $\rightarrow$ {{payroll.gross_wages}}
 *      EPF Wages $\rightarrow$ {{payroll.epf_wages}}
 *      EPS Wages $\rightarrow$ {{payroll.eps_wages}}
 *      EDLI Wages $\rightarrow$ {{payroll.edli_wages}}
 *      EE Share Remitted $\rightarrow$ {{payroll.employee_pf}}
 *      EPS Share Remitted $\rightarrow$ {{payroll.eps}}
 *      ER Share Remitted $\rightarrow$ {{payroll.employer_pf}}
 *      NCP Days $\rightarrow$ {{employee.ncp_days}}
 *      Refund of Advances $\rightarrow$ {{employee.refund}}
 *      Arrear EPF/EPS/EDLI Wages & Remittances $\rightarrow$ {{employee.arrears}}
 *
 * 2. Delimiter File Generation:
 *    - Standard EPFO delimiter-separated format (#~#)
 *
 * 3. SHA-256 Checksum Computation:
 *    - Verifies 64-char hexadecimal hash accuracy
 *
 * 4. ComplianceReturn Metadata & Persistence:
 *    - Verified with scheme: 'EPF_ECR', artifact metadata, summary metrics
 *
 * 5. REST API Integration
 *
 * @version 5.0.0
 * @author Kylrx AI Lead Compliance Architect
 */

import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import express from 'express';

import {
  FieldMappingEngine,
  EcrFileGenerator,
  globalEcrFileGenerator,
  getEcrComplianceReturns,
  getEcrComplianceReturnById,
  clearEcrComplianceReturns,
  ECR_RULE_VERSION,
  ECR_DELIMITER,
} from '../services/ecr-formatting-file-generator.mjs';

import pfComplianceRouter from '../routes/pf-compliance.mjs';

describe('📑 Section 5: ECR Formatting and File Generator (EPFO ECR Engine)', () => {
  let app;
  let server;
  let baseUrl;
  let generator;

  before(async () => {
    app = express();
    app.use(express.json());
    app.use('/api/v1/pf', pfComplianceRouter);

    await new Promise((resolve) => {
      server = app.listen(0, () => {
        const port = server.address().port;
        baseUrl = `http://127.0.0.1:${port}/api/v1/pf`;
        resolve();
      });
    });
  });

  after(async () => {
    if (server) {
      await new Promise((resolve) => server.close(resolve));
    }
  });

  beforeEach(() => {
    clearEcrComplianceReturns();
    generator = new EcrFileGenerator();
  });

  // ==========================================================================
  // 1. DYNAMIC FIELD MAPPING ENGINE
  // ==========================================================================
  describe('1. Dynamic Field Mapping Engine', () => {
    it('1.1 Should dynamically map internal database fields into canonical ECR fields', () => {
      const employee = {
        uan: '100912345678',
        pf_member_id: 'MH/BAN/0012345/000/0000789',
        name: 'Rohan Deshmukh',
        ncp_days: 2,
        refund: 500,
        arrears: {
          arrear_epf_wages: 5000,
          arrear_ee_share: 600,
          arrear_er_share: 184,
          arrear_eps_share: 416,
        },
      };

      const payroll = {
        gross_wages: 45000,
        epf_wages: 15000,
        eps_wages: 15000,
        edli_wages: 15000,
        employee_pf: 1800,
        eps: 1250,
        employer_pf: 550,
      };

      const mapped = FieldMappingEngine.mapRecord(employee, payroll);

      // Verify canonical mappings:
      // UAN -> {{employee.uan}}
      assert.strictEqual(mapped.uan, '100912345678');
      // Member ID -> {{employee.pf_member_id}}
      assert.strictEqual(mapped.pf_member_id, 'MH/BAN/0012345/000/0000789');
      // Member Name -> {{employee.name}}
      assert.strictEqual(mapped.name, 'Rohan Deshmukh');
      // Gross Wages -> {{payroll.gross_wages}}
      assert.strictEqual(mapped.gross_wages, 45000);
      // EPF Wages -> {{payroll.epf_wages}}
      assert.strictEqual(mapped.epf_wages, 15000);
      // EPS Wages -> {{payroll.eps_wages}}
      assert.strictEqual(mapped.eps_wages, 15000);
      // EDLI Wages -> {{payroll.edli_wages}}
      assert.strictEqual(mapped.edli_wages, 15000);
      // EE Share Remitted -> {{payroll.employee_pf}}
      assert.strictEqual(mapped.employee_pf, 1800);
      // EPS Share Remitted -> {{payroll.eps}}
      assert.strictEqual(mapped.eps, 1250);
      // ER Share Remitted -> {{payroll.employer_pf}}
      assert.strictEqual(mapped.employer_pf, 550);
      // NCP Days -> {{employee.ncp_days}}
      assert.strictEqual(mapped.ncp_days, 2);
      // Refund of Advances -> {{employee.refund}}
      assert.strictEqual(mapped.refund, 500);
      // Arrear EPF/EPS/EDLI Wages & Remittances -> {{employee.arrears}}
      assert.deepStrictEqual(mapped.arrears, {
        arrear_epf_wages: 5000,
        arrear_ee_share: 600,
        arrear_er_share: 184,
        arrear_eps_share: 416,
      });
    });

    it('1.2 Should sanitize delimiter characters (# and ~) from Member Name', () => {
      const employee = {
        uan: '100999888777',
        pf_member_id: 'MH/BAN/0012345/000/0000999',
        name: 'John#~#Doe#Special',
      };
      const payroll = {
        gross_wages: 20000,
        epf_wages: 15000,
        eps_wages: 15000,
        edli_wages: 15000,
        employee_pf: 1800,
        eps: 1250,
        employer_pf: 550,
      };

      const mapped = FieldMappingEngine.mapRecord(employee, payroll);
      assert.ok(!mapped.name.includes('#'));
      assert.ok(!mapped.name.includes('~'));
      assert.strictEqual(mapped.name, 'JohnDoeSpecial');
    });
  });

  // ==========================================================================
  // 2. DELIMITER FILE GENERATION (#~# FORMAT)
  // ==========================================================================
  describe('2. Delimiter File Generation (#~# format)', () => {
    it('2.1 Should compile output into the standard EPFO delimiter-separated format (#~#)', () => {
      const mappedRecord = {
        uan: '100111222333',
        name: 'Vandana Shiva',
        gross_wages: 30000,
        epf_wages: 15000,
        eps_wages: 15000,
        edli_wages: 15000,
        employee_pf: 1800,
        eps: 1250,
        employer_pf: 550,
        ncp_days: 0,
        refund: 0,
      };

      const row = generator.compileEcrRow(mappedRecord);
      const expectedRow = '100111222333#~#Vandana Shiva#~#30000#~#15000#~#15000#~#15000#~#1800#~#1250#~#550#~#0#~#0';
      assert.strictEqual(row, expectedRow);

      const segments = row.split('#~#');
      assert.strictEqual(segments.length, 11);
      assert.strictEqual(segments[0], '100111222333');
      assert.strictEqual(segments[1], 'Vandana Shiva');
      assert.strictEqual(segments[2], '30000');
      assert.strictEqual(segments[3], '15000');
      assert.strictEqual(segments[4], '15000');
      assert.strictEqual(segments[5], '15000');
      assert.strictEqual(segments[6], '1800');
      assert.strictEqual(segments[7], '1250');
      assert.strictEqual(segments[8], '550');
      assert.strictEqual(segments[9], '0');
      assert.strictEqual(segments[10], '0');
    });

    it('2.2 Should correctly append Arrear EPF/EPS/EDLI Wages & Remittances if configured', () => {
      const recordWithArrears = {
        uan: '100222333444',
        name: 'Nitin Gadgil',
        gross_wages: 25000,
        epf_wages: 15000,
        eps_wages: 15000,
        edli_wages: 15000,
        employee_pf: 1800,
        eps: 1250,
        employer_pf: 550,
        ncp_days: 1,
        refund: 0,
        arrears: {
          arrear_epf_wages: 3000,
          arrear_ee_share: 360,
          arrear_er_share: 110,
          arrear_eps_share: 250,
        },
      };

      const row = generator.compileEcrRow(recordWithArrears);
      const expectedRow = '100222333444#~#Nitin Gadgil#~#25000#~#15000#~#15000#~#15000#~#1800#~#1250#~#550#~#1#~#0#~#3000#~#360#~#110#~#250';
      assert.strictEqual(row, expectedRow);
      const segments = row.split('#~#');
      assert.strictEqual(segments.length, 15);
    });
  });

  // ==========================================================================
  // 3. SHA-256 CHECKSUM COMPUTATION
  // ==========================================================================
  describe('3. Cryptographic SHA-256 Checksum Computation', () => {
    it('3.1 Should compute an authentic 64-character SHA-256 checksum for the generated .txt file', async () => {
      const records = [
        {
          employee: { uan: '100123456789', pf_member_id: 'MH/BAN/001/01', name: 'Alok Sharma', ncp_days: 0, refund: 0 },
          payroll: { gross_wages: 25000, epf_wages: 15000, eps_wages: 15000, edli_wages: 15000, employee_pf: 1800, eps: 1250, employer_pf: 550 },
        },
        {
          employee: { uan: '100987654321', pf_member_id: 'MH/BAN/001/02', name: 'Bhavna Roy', ncp_days: 1, refund: 0 },
          payroll: { gross_wages: 22000, epf_wages: 15000, eps_wages: 15000, edli_wages: 15000, employee_pf: 1800, eps: 1250, employer_pf: 550 },
        },
      ];

      const result = await generator.generateEcrReturn({
        period: '2026-09',
        establishment_id: 'DLCPM0012345000',
        records,
      });

      assert.strictEqual(result.success, true);
      assert.ok(result.checksum_sha256);
      assert.strictEqual(result.checksum_sha256.length, 64);

      // Verify cryptographic consistency
      const expectedChecksum = crypto.createHash('sha256').update(result.content, 'utf8').digest('hex');
      assert.strictEqual(result.checksum_sha256, expectedChecksum);
    });
  });

  // ==========================================================================
  // 4. COMPLIANCE RETURN METADATA & PERSISTENCE (scheme: 'EPF_ECR')
  // ==========================================================================
  describe('4. ComplianceReturn Metadata & In-Memory Registry', () => {
    it('4.1 Should persist file metadata in ComplianceReturn with scheme "EPF_ECR"', async () => {
      const records = [
        {
          employee: { uan: '100111222333', pf_member_id: 'MH/BAN/001/03', name: 'Devendra Joshi', ncp_days: 0, refund: 0 },
          payroll: { gross_wages: 25000, epf_wages: 15000, eps_wages: 15000, edli_wages: 15000, employee_pf: 1800, eps: 1250, employer_pf: 550 },
        },
      ];

      const result = await generator.generateEcrReturn({
        period: '2026-09',
        establishment_id: 'MHBAN0012345000',
        source_payroll_run_id: 'PR_RUN_2026_09',
        admin_id: 'lead-compliance-officer',
        records,
      });

      const cr = result.compliance_return;
      assert.ok(cr);

      // 1. Mandatory Schema Validation
      assert.strictEqual(cr.scheme, 'EPF_ECR');
      assert.strictEqual(cr.statutory_head, 'PF');
      assert.strictEqual(cr.wage_month, '2026-09');
      assert.strictEqual(cr.policy_version_applied, 4);
      assert.strictEqual(cr.status, 'GENERATED');
      assert.strictEqual(cr.identifier_type, 'UAN');
      assert.strictEqual(cr.establishment_id, 'MHBAN0012345000');

      // 2. Summary Metrics Validation
      assert.strictEqual(cr.summary.total_eligible_headcount, 1);
      assert.strictEqual(cr.summary.total_statutory_wages, 15000);
      assert.strictEqual(cr.summary.total_employee_deductions, 1800);
      assert.strictEqual(cr.summary.total_employer_liability, 1800); // EPS (1250) + ER EPF (550) = 1800
      assert.strictEqual(cr.summary.total_payable_challan, 3600);   // EE (1800) + ER (1800) = 3600

      // 3. Export Artifact Validation
      assert.strictEqual(cr.export_artifact.file_type, 'ECR_TXT');
      assert.strictEqual(cr.export_artifact.file_name, 'EPFO_ECR_MHBAN0012345000_2026_09.txt');
      assert.strictEqual(cr.export_artifact.checksum_sha256, result.checksum_sha256);
      assert.ok(cr.export_artifact.storage_path.includes('EPFO_ECR_MHBAN0012345000_2026_09.txt'));
      assert.ok(Date.parse(cr.export_artifact.generated_at));

      // 4. In-Memory Registry Persistence
      const allReturns = getEcrComplianceReturns({ period: '2026-09' });
      assert.strictEqual(allReturns.length, 1);
      const fetched = getEcrComplianceReturnById(cr.return_id);
      assert.ok(fetched);
      assert.strictEqual(fetched.scheme, 'EPF_ECR');
    });
  });

  // ==========================================================================
  // 5. REST API ENDPOINTS INTEGRATION
  // ==========================================================================
  describe('5. REST API Endpoints Integration', () => {
    it('5.1 POST /api/v1/pf/generate-ecr and GET /compliance-returns', async () => {
      const payload = {
        period: '2026-09',
        establishment_id: 'KAWHT0098765000',
        source_payroll_run_id: 'PR_API_ECR_TEST',
        records: [
          {
            employee: {
              uan: '100444555666',
              pf_member_id: 'KA/WHT/0098765/000/0000001',
              name: 'Gita Sen',
              ncp_days: 0,
              refund: 0,
            },
            payroll: {
              gross_wages: 20000,
              epf_wages: 15000,
              eps_wages: 15000,
              edli_wages: 15000,
              employee_pf: 1800,
              eps: 1250,
              employer_pf: 550,
            },
          },
        ],
      };

      // 1. POST /generate-ecr
      const res = await fetch(`${baseUrl}/generate-ecr`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      assert.strictEqual(res.status, 200);
      const data = await res.json();
      assert.strictEqual(data.success, true);
      assert.strictEqual(data.rule_version, ECR_RULE_VERSION);
      assert.strictEqual(data.data.file_type, 'ECR_TXT');
      assert.strictEqual(data.data.compliance_return.scheme, 'EPF_ECR');
      assert.ok(data.data.content.includes('100444555666#~#Gita Sen#~#20000#~#15000#~#15000#~#15000#~#1800#~#1250#~#550#~#0#~#0'));

      const returnId = data.data.compliance_return.return_id;

      // 2. GET /compliance-returns
      const listRes = await fetch(`${baseUrl}/compliance-returns?period=2026-09`);
      assert.strictEqual(listRes.status, 200);
      const listData = await listRes.json();
      assert.ok(listData.data.total_count >= 1);
      assert.ok(listData.data.returns.some((r) => r.return_id === returnId));

      // 3. GET /compliance-returns/:id
      const singleRes = await fetch(`${baseUrl}/compliance-returns/${returnId}`);
      assert.strictEqual(singleRes.status, 200);
      const singleData = await singleRes.json();
      assert.strictEqual(singleData.success, true);
      assert.strictEqual(singleData.data.scheme, 'EPF_ECR');
      assert.strictEqual(singleData.data.return_id, returnId);
    });
  });
});
