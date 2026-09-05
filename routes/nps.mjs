/**
 * ============================================================================
 * KYLRX AI ENTERPRISE HRMS - CORPORATE NPS AUTOMATION REST API ROUTES
 * ============================================================================
 * Implements Column 3 of the Visual Compliance Blueprint:
 *
 * 1. Profile Master:
 *    - POST /profiles: Upsert EmployeeNPSProfile (employee_id, pran [12-digit],
 *      nps_applicable, tier [Tier I / Tier II], date_of_joining, contribution_type, exit_date)
 *    - GET  /profiles: Query master NPS profiles
 *    - GET  /template: Download standardized template (.csv / .xlsx)
 *    - POST /upload-master: Ingest bulk master profiles (Excel / CSV / JSON)
 *
 * 2. Automation Builder & Contribution Engine:
 *    - POST /trigger: Trigger NPS calculation on monthly Payroll Finalized
 *    - GET  /summary/:batch_id: Batch summary & statutory contribution totals
 *
 * 3. 7-Stage Visual Compliance Stepper:
 *    - GET  /stepper/:batch_id: Current stepper progress and stage history
 *    - POST /stepper/:batch_id/advance: Advance lifecycle stage with defect gatekeeping
 *    - POST /stepper/:batch_id/acknowledge: Record NSDL PRN acknowledgement receipt
 *
 * 4. Validation Exceptions, HR Tasks & Alerts:
 *    - GET  /exceptions: Query PRAN validation defects (missing PRAN, invalid format)
 *    - POST /exceptions/:issue_id/resolve: Inline remediation with corrected PRAN
 *    - GET  /tasks: Query HR tasks for exception review
 *    - GET  /alerts: Query real-time compliance alerts
 *
 * 5. Official NSDL File Output:
 *    - GET  /export/:batch_id: Download official NPS_Contribution_MONTH_YEAR.txt
 *      Layout: [PRAN, Employee Name, Employee Amt, Employer Amt, Total Amount]
 *
 * @version 4.0.0
 * @author Kylrx AI Lead Backend Compliance Engineer
 */

import { Router } from 'express';
import multer from 'multer';
import {
  globalCorporateNpsAutomationEngine,
  NPS_STEPPER_STAGES,
  NPS_STAGE_LABELS,
  NPS_12_DIGIT_PRAN_REGEX,
  NPS_EMPLOYEE_STATUTORY_RATE,
  NPS_EMPLOYER_STATUTORY_RATE,
  NPS_80CCD1B_ANNUAL_CAP,
} from '../services/corporate-nps-automation-engine.mjs';

const router = Router();

// Multer in-memory storage for bulk uploads (up to 15MB)
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 15 * 1024 * 1024 },
});

// Helper to sanitize batchId
const sanitizeBatchId = (batchId) => (batchId || '').replace(/[^a-zA-Z0-9_-]/g, '');

/**
 * ----------------------------------------------------------------------------
 * 1. PROFILE MASTER (EmployeeNPSProfile)
 * ----------------------------------------------------------------------------
 */

/**
 * POST /profiles
 * Upserts employee master NPS profile
 */
router.post('/profiles', (req, res) => {
  try {
    const profile = globalCorporateNpsAutomationEngine.profileStore.upsertProfile(req.body);
    return res.status(200).json({
      success: true,
      message: `EmployeeNPSProfile saved for ${profile.employee_id}`,
      data: profile,
    });
  } catch (err) {
    return res.status(400).json({
      success: false,
      error: { code: 'INVALID_PROFILE_DATA', message: err.message },
    });
  }
});

/**
 * GET /profiles
 * Query all NPS master profiles
 */
router.get('/profiles', (req, res) => {
  try {
    const profiles = globalCorporateNpsAutomationEngine.profileStore.getAllProfiles();
    return res.status(200).json({
      success: true,
      data: {
        total_count: profiles.length,
        count: profiles.length,
        profiles,
      },
    });
  } catch (err) {
    return res.status(500).json({
      success: false,
      error: { code: 'PROFILE_QUERY_FAILED', message: err.message },
    });
  }
});

/**
 * GET /template
 * Download standardized Employee NPS Master Template (.csv / .xls)
 */
router.get('/template', (req, res) => {
  const format = String(req.query.format || 'csv').toLowerCase();

  if (format === 'xlsx' || format === 'xls') {
    const xmlContent = `<?xml version="1.0" encoding="UTF-8"?>
<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet"
 xmlns:o="urn:schemas-microsoft-com:office:office"
 xmlns:x="urn:schemas-microsoft-com:office:excel"
 xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet">
 <Worksheet ss:Name="NPS_Master">
  <Table>
   <Row>
    <Cell><Data ss:Type="String">employee_id</Data></Cell>
    <Cell><Data ss:Type="String">employee_name</Data></Cell>
    <Cell><Data ss:Type="String">pran</Data></Cell>
    <Cell><Data ss:Type="String">nps_applicable</Data></Cell>
    <Cell><Data ss:Type="String">tier</Data></Cell>
    <Cell><Data ss:Type="String">date_of_joining</Data></Cell>
    <Cell><Data ss:Type="String">contribution_type</Data></Cell>
    <Cell><Data ss:Type="String">exit_date</Data></Cell>
    <Cell><Data ss:Type="String">voluntary_monthly_amount</Data></Cell>
   </Row>
   <Row>
    <Cell><Data ss:Type="String">EMP_NPS_001</Data></Cell>
    <Cell><Data ss:Type="String">Aarav Sharma</Data></Cell>
    <Cell><Data ss:Type="String">110012345678</Data></Cell>
    <Cell><Data ss:Type="String">true</Data></Cell>
    <Cell><Data ss:Type="String">Tier I</Data></Cell>
    <Cell><Data ss:Type="String">2020-03-01</Data></Cell>
    <Cell><Data ss:Type="String">Both</Data></Cell>
    <Cell><Data ss:Type="String"></Data></Cell>
    <Cell><Data ss:Type="Number">0</Data></Cell>
   </Row>
   <Row>
    <Cell><Data ss:Type="String">EMP_NPS_002</Data></Cell>
    <Cell><Data ss:Type="String">Pooja Bhatt</Data></Cell>
    <Cell><Data ss:Type="String">110033332222</Data></Cell>
    <Cell><Data ss:Type="String">true</Data></Cell>
    <Cell><Data ss:Type="String">Tier I</Data></Cell>
    <Cell><Data ss:Type="String">2021-06-15</Data></Cell>
    <Cell><Data ss:Type="String">Both</Data></Cell>
    <Cell><Data ss:Type="String"></Data></Cell>
    <Cell><Data ss:Type="Number">1000</Data></Cell>
   </Row>
   <Row>
    <Cell><Data ss:Type="String">EMP_NPS_003</Data></Cell>
    <Cell><Data ss:Type="String">Rohan Verma</Data></Cell>
    <Cell><Data ss:Type="String">110077778888</Data></Cell>
    <Cell><Data ss:Type="String">true</Data></Cell>
    <Cell><Data ss:Type="String">Tier II</Data></Cell>
    <Cell><Data ss:Type="String">2022-01-10</Data></Cell>
    <Cell><Data ss:Type="String">Employee</Data></Cell>
    <Cell><Data ss:Type="String"></Data></Cell>
    <Cell><Data ss:Type="Number">0</Data></Cell>
   </Row>
  </Table>
 </Worksheet>
</Workbook>`;
    res.setHeader('Content-Type', 'application/vnd.ms-excel; charset=UTF-8');
    res.setHeader('Content-Disposition', 'attachment; filename="Employee_NPS_Master_Template.xls"');
    return res.send(xmlContent);
  }

  const csvContent = [
    'employee_id,employee_name,pran,nps_applicable,tier,date_of_joining,contribution_type,exit_date,voluntary_monthly_amount',
    'EMP_NPS_001,Aarav Sharma,110012345678,true,Tier I,2020-03-01,Both,,0',
    'EMP_NPS_002,Pooja Bhatt,110033332222,true,Tier I,2021-06-15,Both,,1000',
    'EMP_NPS_003,Rohan Verma,110077778888,true,Tier II,2022-01-10,Employee,,0',
  ].join('\r\n');

  res.setHeader('Content-Type', 'text/csv; charset=UTF-8');
  res.setHeader('Content-Disposition', 'attachment; filename="Employee_NPS_Master_Template.csv"');
  return res.send(csvContent);
});

/**
 * POST /upload-master
 * Bulk ingestion of NPS master records (Excel / CSV / JSON)
 */
router.post('/upload-master', upload.single('file'), (req, res) => {
  try {
    let rows = [];
    let fileName = 'NPS_Master.csv';

    if (req.file) {
      const text = req.file.buffer.toString('utf8');
      fileName = req.file.originalname || fileName;
      rows = parseCsvOrJson(text);
    } else if (Array.isArray(req.body.rows)) {
      rows = req.body.rows;
    } else if (req.body.content) {
      rows = parseCsvOrJson(req.body.content);
    } else {
      return res.status(400).json({
        success: false,
        error: 'No file or data provided. Upload file or pass rows in body.',
      });
    }

    const staged = [];
    for (const r of rows) {
      const empId = r.employee_id || r.Employee_ID || r.employeeId;
      if (empId) {
        staged.push(
          globalCorporateNpsAutomationEngine.profileStore.upsertProfile({
            employee_id: empId,
            employee_name: r.employee_name || r.Employee_Name || r.name,
            pran: r.pran || r.PRAN || '',
            nps_applicable: r.nps_applicable !== undefined ? r.nps_applicable : true,
            tier: r.tier || r.Tier || 'Tier I',
            date_of_joining: r.date_of_joining || r.DOJ || '2020-01-01',
            contribution_type: r.contribution_type || r.Contribution_Type || 'Both',
            exit_date: r.exit_date || r.Exit_Date || null,
            voluntary_monthly_amount: Number(r.voluntary_monthly_amount || 0),
            department: r.department || 'Engineering',
          })
        );
      }
    }

    return res.status(200).json({
      success: true,
      message: `Ingested ${staged.length} profiles from ${fileName}`,
      count: staged.length,
      profiles: staged,
    });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * ----------------------------------------------------------------------------
 * 2. AUTOMATION BUILDER & CONTRIBUTION ENGINE
 * ----------------------------------------------------------------------------
 */

/**
 * POST /trigger
 * Trigger Corporate NPS calculation & validation on monthly Payroll Finalized
 */
router.post('/trigger', async (req, res) => {
  try {
    const payload = req.body || {};
    const result = await globalCorporateNpsAutomationEngine.handlePayrollFinalized(payload);
    const stepper = globalCorporateNpsAutomationEngine.getStepperState(result.batch_id);

    return res.status(200).json({
      success: true,
      message: `NPS calculation executed for batch ${result.batch_id}`,
      data: result,
      stepper,
    });
  } catch (err) {
    return res.status(500).json({
      success: false,
      error: { code: 'TRIGGER_FAILED', message: err.message },
    });
  }
});

/**
 * GET /summary/:batch_id
 * Retrieve summary metrics and statutory contribution totals
 */
router.get('/summary/:batch_id', (req, res) => {
  try {
    const batchId = sanitizeBatchId(req.params.batch_id);
    const result = globalCorporateNpsAutomationEngine.calculationResults.get(batchId);

    if (!result) {
      return res.status(404).json({
        success: false,
        error: { code: 'BATCH_NOT_FOUND', message: `No calculation results found for batch ${batchId}` },
      });
    }

    return res.status(200).json({
      success: true,
      data: {
        batch_id: batchId,
        period: result.period,
        summary: result.summary,
        total_subscribers: result.compliant_subscribers?.length || 0,
        unresolved_defects: result.unresolved_blocking_defects_count || 0,
        is_blocked: result.is_blocked,
        calculated_at: result.calculated_at,
      },
    });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * ----------------------------------------------------------------------------
 * 3. 7-STAGE VISUAL COMPLIANCE STEPPER & GATEKEEPING
 * ----------------------------------------------------------------------------
 */

/**
 * GET /stepper/:batch_id
 * Retrieve stepper state and timeline history
 */
router.get('/stepper/:batch_id', (req, res) => {
  try {
    const batchId = sanitizeBatchId(req.params.batch_id);
    const stepperState = globalCorporateNpsAutomationEngine.getStepperState(batchId);

    if (!stepperState) {
      return res.status(404).json({
        success: false,
        error: {
          code: 'NPS_STEPPER_NOT_FOUND',
          message: `NPS Stepper state not found for batch ${batchId}`,
        },
        stages: NPS_STEPPER_STAGES.map((s) => ({ stage: s, label: NPS_STAGE_LABELS[s] })),
      });
    }

    return res.status(200).json({
      success: true,
      data: stepperState,
    });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * POST /stepper/:batch_id/advance
 * Advance lifecycle stage with defect gatekeeping
 */
router.post('/stepper/:batch_id/advance', (req, res) => {
  try {
    const batchId = sanitizeBatchId(req.params.batch_id);
    const { target_stage, actor = 'COMPLIANCE_LEAD', notes, force = false } = req.body;

    if (!target_stage) {
      return res.status(400).json({
        success: false,
        error: { code: 'MISSING_TARGET_STAGE', message: 'target_stage is required' },
      });
    }

    try {
      const updatedState = globalCorporateNpsAutomationEngine.advanceLifecycle(batchId, target_stage, {
        actor,
        notes,
        force: Boolean(force),
      });

      return res.status(200).json({
        success: true,
        message: `Advanced batch ${batchId} to stage ${target_stage}`,
        data: updatedState,
      });
    } catch (advanceErr) {
      const status = advanceErr.statusCode || (advanceErr.code === 'NPS_BLOCKING_DEFECTS' ? 422 : 400);
      return res.status(status).json({
        success: false,
        error: {
          code: advanceErr.code || 'STAGE_TRANSITION_FAILED',
          message: advanceErr.message,
          unresolved_count: advanceErr.unresolved_count,
          defects: advanceErr.defects,
        },
      });
    }
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * POST /stepper/:batch_id/acknowledge
 * Stage 6: Record NSDL acknowledgement receipt (PRN / Ack No)
 */
router.post('/stepper/:batch_id/acknowledge', (req, res) => {
  try {
    const batchId = sanitizeBatchId(req.params.batch_id);
    const { acknowledgement_number, prn, received_at, recorded_by = 'finance-desk', notes } = req.body;

    const token = prn || acknowledgement_number;
    if (!token) {
      return res.status(400).json({
        success: false,
        error: { code: 'MISSING_PRN', message: 'Acknowledgement token / PRN is mandatory' },
      });
    }

    try {
      const ackState = globalCorporateNpsAutomationEngine.recordNsdlAcknowledgement(batchId, {
        acknowledgement_number: token,
        prn: token,
        received_at,
        recorded_by,
        notes: notes || `NSDL PRN recorded: ${token}`,
      });

      return res.status(200).json({
        success: true,
        message: `NSDL acknowledgement recorded with PRN ${token}`,
        data: ackState,
      });
    } catch (ackErr) {
      return res.status(400).json({
        success: false,
        error: { code: ackErr.code || 'ACKNOWLEDGEMENT_FAILED', message: ackErr.message },
      });
    }
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * ----------------------------------------------------------------------------
 * 4. VALIDATION EXCEPTIONS, HR TASKS & ALERTS
 * ----------------------------------------------------------------------------
 */

/**
 * GET /exceptions
 * Query NPS validation issues (missing PRAN, invalid format)
 */
router.get('/exceptions', (req, res) => {
  try {
    const batchId = req.query.batch_id ? sanitizeBatchId(req.query.batch_id) : null;
    let issues = [];

    if (batchId) {
      issues = globalCorporateNpsAutomationEngine.validationIssues.get(batchId) || [];
    } else {
      for (const list of globalCorporateNpsAutomationEngine.validationIssues.values()) {
        issues.push(...list);
      }
    }

    return res.status(200).json({
      success: true,
      data: {
        total_count: issues.length,
        unresolved_count: issues.filter((i) => !i.resolved).length,
        issues,
      },
    });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * POST /exceptions/:issue_id/resolve
 * Inline remediation of PRAN defect and unblocking of export
 */
router.post('/exceptions/:issue_id/resolve', (req, res) => {
  try {
    const issueId = req.params.issue_id;
    const { corrected_pran, resolved_by = 'hr-officer', fix_applied } = req.body;

    // If a corrected PRAN is passed, update the underlying profile
    if (corrected_pran) {
      if (!NPS_12_DIGIT_PRAN_REGEX.test(corrected_pran)) {
        return res.status(400).json({
          success: false,
          error: {
            code: 'INVALID_CORRECTED_PRAN',
            message: 'Corrected PRAN must consist of exactly 12 numeric digits.',
          },
        });
      }

      // Find the issue to know which employee_id
      let targetEmpId = null;
      for (const issues of globalCorporateNpsAutomationEngine.validationIssues.values()) {
        const found = issues.find((i) => i.issue_id === issueId);
        if (found) {
          targetEmpId = found.employee_id;
          break;
        }
      }

      if (targetEmpId) {
        const existingProfile = globalCorporateNpsAutomationEngine.profileStore.getProfile(targetEmpId);
        if (existingProfile) {
          existingProfile.pran = corrected_pran;
          existingProfile.updated_at = new Date().toISOString();
        }
      }
    }

    const result = globalCorporateNpsAutomationEngine.resolveValidationIssue(issueId, {
      resolved_by,
      fix_applied: fix_applied || (corrected_pran ? `PRAN corrected to ${corrected_pran}` : 'Resolved manually by HR'),
    });

    if (!result.success) {
      return res.status(404).json({
        success: false,
        error: { code: 'NPS_ISSUE_NOT_FOUND', message: result.error },
      });
    }

    return res.status(200).json({
      success: true,
      message: `NPS defect ${issueId} resolved successfully`,
      data: result,
    });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * GET /tasks
 * Query HR compliance tasks generated by NPS exceptions
 */
router.get('/tasks', (req, res) => {
  try {
    const batchId = req.query.batch_id ? sanitizeBatchId(req.query.batch_id) : null;
    let tasks = [];

    if (batchId) {
      tasks = globalCorporateNpsAutomationEngine.hrTasks.get(batchId) || [];
    } else {
      for (const list of globalCorporateNpsAutomationEngine.hrTasks.values()) {
        tasks.push(...list);
      }
    }

    return res.status(200).json({
      success: true,
      data: {
        total_count: tasks.length,
        pending_count: tasks.filter((t) => t.status === 'PENDING').length,
        tasks,
      },
    });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * GET /alerts
 * Query real-time compliance alerts generated by NPS
 */
router.get('/alerts', (req, res) => {
  try {
    const batchId = req.query.batch_id ? sanitizeBatchId(req.query.batch_id) : null;
    let alerts = [];

    if (batchId) {
      alerts = globalCorporateNpsAutomationEngine.hrAlerts.get(batchId) || [];
    } else {
      for (const list of globalCorporateNpsAutomationEngine.hrAlerts.values()) {
        alerts.push(...list);
      }
    }

    return res.status(200).json({
      success: true,
      data: {
        total_count: alerts.length,
        alerts,
      },
    });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * ----------------------------------------------------------------------------
 * 5. OFFICIAL NSDL FILE OUTPUT (NPS_Contribution_MONTH_YEAR.txt)
 * ----------------------------------------------------------------------------
 */

/**
 * GET /export/:batch_id
 * Retrieve or download official NSDL upload file NPS_Contribution_MONTH_YEAR.txt
 * Layout: [PRAN, Employee Name, Employee Amt, Employer Amt, Total Amount]
 */
router.get('/export/:batch_id', (req, res) => {
  try {
    const batchId = sanitizeBatchId(req.params.batch_id);
    let exportFile = globalCorporateNpsAutomationEngine.exportFiles.get(batchId);

    if (!exportFile) {
      try {
        exportFile = globalCorporateNpsAutomationEngine.generateNsdlExportFile(batchId);
      } catch (err) {
        return res.status(404).json({
          success: false,
          error: { code: 'NPS_EXPORT_NOT_FOUND', message: err.message },
        });
      }
    }

    const format = String(req.query.format || 'txt').toLowerCase();
    if (format === 'json') {
      return res.status(200).json({
        success: true,
        data: exportFile,
      });
    }

    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${exportFile.manifest.file_name}"`);
    return res.status(200).send(exportFile.txt);
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

function parseCsvOrJson(content) {
  if (!content) return [];
  const text = String(content).trim();
  if (text.startsWith('[') || text.startsWith('{')) {
    try {
      const parsed = JSON.parse(text);
      return Array.isArray(parsed) ? parsed : parsed.rows || [];
    } catch (e) {
      // Fall through to CSV
    }
  }

  const lines = text.split(/\r?\n/).filter(Boolean);
  if (lines.length < 2) return [];

  const headers = lines[0].split(',').map((h) => h.trim().replace(/^"|"$/g, ''));
  const rows = [];

  for (let i = 1; i < lines.length; i++) {
    const vals = lines[i].split(',').map((v) => v.trim().replace(/^"|"$/g, ''));
    const obj = {};
    headers.forEach((h, idx) => {
      obj[h] = vals[idx] !== undefined ? vals[idx] : '';
    });
    rows.push(obj);
  }
  return rows;
}

export default router;
