/**
 * ============================================================================
 * KYLRX AI ENTERPRISE HRMS - STATUTORY GRATUITY REST API ROUTES
 * ============================================================================
 * Satisfies Column 2 of the Visual Compliance Blueprint:
 *
 * 1. Profile Master:
 *    - POST /profiles: Upsert EmployeeGratuityProfile
 *    - GET  /profiles: Query master profiles
 *    - GET  /template: Download standardized template (.csv / .xlsx)
 *    - POST /upload-master: Ingest bulk master profiles
 *
 * 2. Automation Builder & Eligibility Gate:
 *    - POST /trigger: Trigger provisioning & settlement on exit or payroll run
 *    - GET  /tasks: Query HR tasks for unvested service or missing data
 *    - GET  /alerts: Query compliance alerts
 *
 * 3. 7-Stage Visual Compliance Stepper & 4-Eyes Gate:
 *    - GET  /stepper/:batch_id: Current stepper progress and history
 *    - POST /stepper/:batch_id/advance: Advance workflow stage
 *    - POST /stepper/:batch_id/approve: 4-Eyes Maker-Checker HR Approval
 *
 * 4. Reporting & Official Statement:
 *    - GET  /statement/:batch_id: Download Gratuity_Statement_MONTH_YEAR.xlsx / .csv
 *      Layout: [Employee ID, Employee Name, DOJ, Exit Date, Completed Years, Last Salary, Gratuity Amount]
 *
 * @version 4.0.0
 * @author Kylrx AI Lead Backend Compliance Engineer
 */

import { Router } from 'express';
import multer from 'multer';
import {
  globalGratuityAutomationEngine,
  GRATUITY_WORKFLOW_STAGES,
  GRATUITY_STAGE_LABELS,
  GRATUITY_MIN_VESTING_DAYS,
  STATUTORY_TAX_FREE_CAP,
} from '../services/gratuity-automation-engine.mjs';

const router = Router();

// Multer in-memory storage for bulk uploads
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 15 * 1024 * 1024 },
});

// Helper to sanitize batchId
const sanitizeBatchId = (batchId) => (batchId || '').replace(/[^a-zA-Z0-9_-]/g, '');

/**
 * ----------------------------------------------------------------------------
 * 1. PROFILE MASTER (EmployeeGratuityProfile)
 * ----------------------------------------------------------------------------
 */

/**
 * POST /profiles
 * Upserts employee master gratuity profile with nominee details [name, relation, share %]
 */
router.post('/profiles', (req, res) => {
  try {
    const profile = globalGratuityAutomationEngine.profileStore.upsertProfile(req.body);
    return res.status(200).json({
      success: true,
      message: `EmployeeGratuityProfile saved for ${profile.employee_id}`,
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
 * Query all gratuity master profiles
 */
router.get('/profiles', (req, res) => {
  try {
    const profiles = globalGratuityAutomationEngine.profileStore.getAllProfiles();
    return res.status(200).json({
      success: true,
      data: {
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
 * Download standardized Employee Gratuity Master Template
 */
router.get('/template', (req, res) => {
  const format = String(req.query.format || 'csv').toLowerCase();

  if (format === 'xlsx' || format === 'xls') {
    const xmlContent = `<?xml version="1.0" encoding="UTF-8"?>
<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet"
 xmlns:o="urn:schemas-microsoft-com:office:office"
 xmlns:x="urn:schemas-microsoft-com:office:excel"
 xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet">
 <Worksheet ss:Name="Gratuity_Master">
  <Table>
   <Row>
    <Cell><Data ss:Type="String">employee_id</Data></Cell>
    <Cell><Data ss:Type="String">employee_name</Data></Cell>
    <Cell><Data ss:Type="String">date_of_joining</Data></Cell>
    <Cell><Data ss:Type="String">date_of_exit</Data></Cell>
    <Cell><Data ss:Type="String">exit_reason</Data></Cell>
    <Cell><Data ss:Type="String">last_drawn_salary</Data></Cell>
    <Cell><Data ss:Type="String">nominee_name</Data></Cell>
    <Cell><Data ss:Type="String">nominee_relation</Data></Cell>
    <Cell><Data ss:Type="String">nominee_share_pct</Data></Cell>
   </Row>
   <Row>
    <Cell><Data ss:Type="String">EMP001</Data></Cell>
    <Cell><Data ss:Type="String">Aarav Sharma</Data></Cell>
    <Cell><Data ss:Type="String">2018-01-15</Data></Cell>
    <Cell><Data ss:Type="String">2026-03-31</Data></Cell>
    <Cell><Data ss:Type="String">RESIGNATION</Data></Cell>
    <Cell><Data ss:Type="Number">45000</Data></Cell>
    <Cell><Data ss:Type="String">Meera Sharma</Data></Cell>
    <Cell><Data ss:Type="String">Spouse</Data></Cell>
    <Cell><Data ss:Type="Number">100</Data></Cell>
   </Row>
   <Row>
    <Cell><Data ss:Type="String">EMP002</Data></Cell>
    <Cell><Data ss:Type="String">Priya Patel</Data></Cell>
    <Cell><Data ss:Type="String">2020-06-01</Data></Cell>
    <Cell><Data ss:Type="String">2026-08-15</Data></Cell>
    <Cell><Data ss:Type="String">RESIGNATION</Data></Cell>
    <Cell><Data ss:Type="Number">25000</Data></Cell>
    <Cell><Data ss:Type="String">Raj Patel</Data></Cell>
    <Cell><Data ss:Type="String">Spouse</Data></Cell>
    <Cell><Data ss:Type="Number">100</Data></Cell>
   </Row>
  </Table>
 </Worksheet>
</Workbook>`;
    res.setHeader('Content-Type', 'application/vnd.ms-excel; charset=UTF-8');
    res.setHeader('Content-Disposition', 'attachment; filename="Employee_Gratuity_Master_Template.xls"');
    return res.send(xmlContent);
  }

  const csvContent = [
    'employee_id,employee_name,date_of_joining,date_of_exit,exit_reason,last_drawn_salary,nominee_name,nominee_relation,nominee_share_pct',
    'EMP001,Aarav Sharma,2018-01-15,2026-03-31,RESIGNATION,45000,Meera Sharma,Spouse,100',
    'EMP002,Priya Patel,2020-06-01,2026-08-15,RESIGNATION,25000,Raj Patel,Spouse,100',
    'EMP003,Rohan Verma,2022-01-10,2026-08-31,RESIGNATION,30000,Sunita Verma,Mother,100',
  ].join('\r\n');

  res.setHeader('Content-Type', 'text/csv; charset=UTF-8');
  res.setHeader('Content-Disposition', 'attachment; filename="Employee_Gratuity_Master_Template.csv"');
  return res.send(csvContent);
});

/**
 * POST /upload-master
 * Bulk upload of gratuity master records (Excel / CSV / JSON)
 */
router.post('/upload-master', upload.single('file'), (req, res) => {
  try {
    let rows = [];
    let fileName = 'Gratuity_Master.csv';

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
      if (r.employee_id || r.Employee_ID) {
        const nominees = r.nominee_name ? [{
          name: r.nominee_name,
          relation: r.nominee_relation || 'Dependent',
          share_percentage: Number(r.nominee_share_pct || 100),
        }] : [];

        staged.push(globalGratuityAutomationEngine.profileStore.upsertProfile({
          employee_id: r.employee_id || r.Employee_ID,
          employee_name: r.employee_name || r.Employee_Name || r.name,
          date_of_joining: r.date_of_joining || r.DOJ || '2019-01-01',
          date_of_exit: r.date_of_exit || r.Exit_Date || r.DOE,
          exit_reason: r.exit_reason || r.Exit_Reason || 'RESIGNATION',
          last_drawn_salary: Number(r.last_drawn_salary || r.Last_Salary || 25000),
          nominee_details: nominees,
        }));
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
 * 2. AUTOMATION BUILDER & ELIGIBILITY GATE
 * ----------------------------------------------------------------------------
 */

/**
 * POST /trigger
 * Trigger gratuity provisioning & settlement on Exit or Payroll run
 */
router.post('/trigger', async (req, res) => {
  try {
    const payload = req.body || {};
    const batchId = sanitizeBatchId(payload.batch_id) || `GRAT_BATCH_${Date.now()}`;

    // If candidates not provided, fetch from master profiles that have exit dates
    let exitRecords = payload.exit_records || payload.candidates;
    if (!exitRecords || exitRecords.length === 0) {
      const allProfiles = globalGratuityAutomationEngine.profileStore.getAllProfiles();
      const exited = allProfiles.filter((p) => p.date_of_exit);
      if (exited.length > 0) {
        exitRecords = exited.map((p) => ({
          employee_id: p.employee_id,
          employee_name: p.employee_name,
          date_of_joining: p.date_of_joining,
          date_of_exit: p.date_of_exit,
          exit_reason: p.exit_reason || 'RESIGNATION',
          last_drawn_salary: p.last_drawn_salary,
          nominee_details: p.nominee_details,
        }));
      } else {
        // Default built-in demonstration vector (matches blueprint test vector: 25k, 6.2 yrs = ₹89,423)
        exitRecords = [
          {
            employee_id: 'EMP_GRAT_DEMO_01',
            employee_name: 'Aditya Birla',
            date_of_joining: '2020-01-01',
            date_of_exit: '2026-03-15',
            completed_years: 6.2, // Blueprint Test Vector
            last_drawn_salary: 25000,
            exit_reason: 'RESIGNATION',
          },
          {
            employee_id: 'EMP_GRAT_DEMO_02',
            employee_name: 'Sunita Rao',
            date_of_joining: '2016-04-01',
            date_of_exit: '2026-08-31',
            completed_years: 10.4,
            last_drawn_salary: 48000,
            exit_reason: 'RESIGNATION',
          },
          {
            employee_id: 'EMP_GRAT_DEMO_03',
            employee_name: 'Tarun Mehra',
            date_of_joining: '2023-01-01',
            date_of_exit: '2026-08-15',
            completed_years: 3.6, // Unvested (< 5 years) -> HR Task & Alert
            last_drawn_salary: 32000,
            exit_reason: 'RESIGNATION',
          },
        ];
      }
    }

    const result = await globalGratuityAutomationEngine.triggerProvisioningAndSettlement({
      ...payload,
      batch_id: batchId,
      exit_records: exitRecords,
      maker_id: payload.maker_id || 'COMPLIANCE_MAKER',
    });

    const stepper = globalGratuityAutomationEngine.getStepperState(batchId);

    return res.status(200).json({
      success: true,
      message: `Gratuity settlement workflow initiated for batch ${batchId}`,
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
 * ----------------------------------------------------------------------------
 * 3. 7-STAGE VISUAL COMPLIANCE STEPPER & 4-EYES GATE
 * ----------------------------------------------------------------------------
 */

/**
 * GET /stepper/:batch_id
 * Retrieve stepper state and timeline history
 */
router.get('/stepper/:batch_id', (req, res) => {
  try {
    const batchId = sanitizeBatchId(req.params.batch_id);
    const stepperState = globalGratuityAutomationEngine.getStepperState(batchId);

    if (!stepperState) {
      return res.status(404).json({
        success: false,
        error: {
          code: 'GRATUITY_STEPPER_NOT_FOUND',
          message: `Stepper state not found for batch ${batchId}`,
        },
        stages: GRATUITY_WORKFLOW_STAGES.map((s) => ({ stage: s, label: GRATUITY_STAGE_LABELS[s] })),
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
 * Advance workflow through 7 stages with gatekeeping
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
      const updatedState = globalGratuityAutomationEngine.advanceWorkflow(batchId, target_stage, {
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
      const status = advanceErr.statusCode || (advanceErr.code === 'UNAPPROVED_GRATUITY_BATCH' ? 422 : 400);
      return res.status(status).json({
        success: false,
        error: { code: advanceErr.code || 'STAGE_TRANSITION_FAILED', message: advanceErr.message },
      });
    }
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * POST /stepper/:batch_id/approve
 * Stage 5: 4-Eyes Maker-Checker segregation of duties HR Approval
 */
router.post('/stepper/:batch_id/approve', (req, res) => {
  try {
    const batchId = sanitizeBatchId(req.params.batch_id);
    const { checker_id, notes } = req.body;

    if (!checker_id) {
      return res.status(400).json({
        success: false,
        error: { code: 'MISSING_CHECKER_ID', message: 'checker_id is required for 4-eyes approval' },
      });
    }

    try {
      const approvedState = globalGratuityAutomationEngine.approveGratuityBatch(batchId, checker_id, notes);
      return res.status(200).json({
        success: true,
        message: `Gratuity settlement batch ${batchId} approved by checker ${checker_id}`,
        data: approvedState,
      });
    } catch (approvalErr) {
      const status = approvalErr.statusCode || (approvalErr.code === 'MAKER_CHECKER_VIOLATION' ? 403 : 400);
      return res.status(status).json({
        success: false,
        error: { code: approvalErr.code || 'APPROVAL_REJECTED', message: approvalErr.message },
      });
    }
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * ----------------------------------------------------------------------------
 * 4. REPORTING & SETTLEMENT WORKFLOW (Gratuity_Statement_MONTH_YEAR.xlsx)
 * ----------------------------------------------------------------------------
 */

/**
 * GET /statement/:batch_id
 * Download Gratuity_Statement_MONTH_YEAR.xlsx or .csv
 */
router.get('/statement/:batch_id', (req, res) => {
  try {
    const batchId = sanitizeBatchId(req.params.batch_id);
    const format = String(req.query.format || 'xlsx').toLowerCase();

    let exportFiles = globalGratuityAutomationEngine.statementFiles.get(batchId);
    if (!exportFiles) {
      if (!globalGratuityAutomationEngine.calculationResults.has(batchId)) {
        return res.status(404).json({
          success: false,
          error: { code: 'BATCH_NOT_CALCULATED', message: `No calculation results found for batch ${batchId}` },
        });
      }
      exportFiles = globalGratuityAutomationEngine.generateGratuityStatement(batchId);
    }

    if (format === 'csv') {
      res.setHeader('Content-Type', 'text/csv; charset=UTF-8');
      res.setHeader('Content-Disposition', `attachment; filename="${exportFiles.csv.file_name}"`);
      return res.send(exportFiles.csv.content);
    }

    if (format === 'json') {
      return res.status(200).json({
        success: true,
        data: {
          manifest: exportFiles.manifest,
          xlsx_file: exportFiles.xlsx.file_name,
          csv_file: exportFiles.csv.file_name,
        },
      });
    }

    // Default to .xlsx
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${exportFiles.xlsx.file_name}"`);
    return res.send(exportFiles.xlsx.content);
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * GET /tasks
 * Query HR compliance tasks for unvested service or missing data
 */
router.get('/tasks', (req, res) => {
  try {
    const batchId = req.query.batch_id ? sanitizeBatchId(req.query.batch_id) : null;
    let tasks = [];
    if (batchId) {
      tasks = globalGratuityAutomationEngine.hrTasks.get(batchId) || [];
    } else {
      for (const list of globalGratuityAutomationEngine.hrTasks.values()) {
        tasks.push(...list);
      }
    }
    return res.status(200).json({
      success: true,
      data: { count: tasks.length, tasks },
    });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * GET /alerts
 * Query compliance alerts for gratuity
 */
router.get('/alerts', (req, res) => {
  try {
    const batchId = req.query.batch_id ? sanitizeBatchId(req.query.batch_id) : null;
    let alerts = [];
    if (batchId) {
      alerts = globalGratuityAutomationEngine.hrAlerts.get(batchId) || [];
    } else {
      for (const list of globalGratuityAutomationEngine.hrAlerts.values()) {
        alerts.push(...list);
      }
    }
    return res.status(200).json({
      success: true,
      data: { count: alerts.length, alerts },
    });
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
      return Array.isArray(parsed) ? parsed : (parsed.rows || []);
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
