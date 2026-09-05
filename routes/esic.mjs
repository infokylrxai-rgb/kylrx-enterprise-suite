/**
 * ============================================================================
 * KYLRX AI ENTERPRISE HRMS - ESIC AUTOMATION REST API ROUTES
 * ============================================================================
 * Implements Column 1 of the Visual Compliance Blueprint:
 *
 * 1. Profile Master & Bulk Upload:
 *    - POST /upload-master: Ingest ESIC_Employee_Master.xlsx or CSV/JSON
 *    - GET  /template: Download standardized ESIC_Employee_Master template
 *    - GET  /profiles: Query master records (with active filter)
 *
 * 2. Automation Builder & Calculation:
 *    - POST /trigger: Trigger ESIC calculation on Payroll Finalized
 *    - GET  /summary/:batch_id: Batch calculation metrics & statutory totals
 *
 * 3. 7-Stage Visual Compliance Stepper:
 *    - GET  /stepper/:batch_id: Current stepper progress and stage history
 *    - POST /stepper/:batch_id/advance: Transition stepper to target stage
 *
 * 4. Exceptions, HR Tasks & Alerts:
 *    - GET  /exceptions: Query ESIC_Exceptions (EMP004, EMP005, EMP006, EMP007)
 *    - POST /exceptions/:exception_id/resolve: Remediate exception & update HR task
 *    - GET  /tasks: Query compliance HR tasks & SLA status
 *    - GET  /alerts: Query real-time compliance alerts
 *
 * 5. Official File Output:
 *    - GET  /export/:batch_id: Download official ESIC_CONTRIBUTION_MONTH_YEAR.txt / .xls
 *
 * @version 4.0.0
 * @author Kylrx AI Lead Backend Compliance Engineer
 */

import { Router } from 'express';
import multer from 'multer';
import {
  globalEsicAutomationEngine,
  ESIC_STEPPER_STAGES,
  ESIC_STEPPER_LABELS,
  ESIC_EXCEPTION_CODES,
  ESIC_STANDARD_WAGE_LIMIT,
  ESIC_DISABLED_WAGE_LIMIT,
  ESIC_EE_RATE,
  ESIC_ER_RATE,
} from '../services/esic-automation-engine.mjs';
import firebaseConfig from '../config/firebase.js';

const db = firebaseConfig?.db || firebaseConfig?.default?.db;

const router = Router();

// Configure Multer for in-memory upload (up to 15MB)
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 15 * 1024 * 1024 },
});

// Resilient Firestore write helper with timeout to prevent gRPC retry hangs when quota is exhausted
async function safeFirestoreSet(collectionName, docId, data) {
  if (!db || typeof db.collection !== 'function') return;
  try {
    await Promise.race([
      db.collection(collectionName).doc(docId).set(data, { merge: true }),
      new Promise((_, reject) => setTimeout(() => reject(new Error('Firestore timeout')), 1200))
    ]);
    console.log(`🔥 [Firestore] Synced ${collectionName}/${docId}`);
  } catch (err) {
    console.warn(`⚠️ [Firestore] Notice on ${collectionName}/${docId}:`, err.message);
  }
}

// Helper to sanitize batchId
const sanitizeBatchId = (batchId) => (batchId || '').replace(/[^a-zA-Z0-9_-]/g, '');

/**
 * ----------------------------------------------------------------------------
 * 1. PROFILE MASTER & BULK UPLOAD
 * ----------------------------------------------------------------------------
 */

/**
 * POST /upload-master
 * Multipart or JSON upload of ESIC_Employee_Master.xlsx / CSV
 */
router.post('/upload-master', upload.single('file'), async (req, res) => {
  try {
    let inputData = null;
    let fileName = 'ESIC_Employee_Master.xlsx';

    if (req.file) {
      inputData = req.file.buffer;
      fileName = req.file.originalname || fileName;
    } else if (req.body.content) {
      inputData = req.body.content;
      fileName = req.body.file_name || fileName;
    } else if (Array.isArray(req.body.rows)) {
      inputData = req.body.rows;
      fileName = req.body.file_name || 'raw_rows.json';
    } else if (req.body.profiles && Array.isArray(req.body.profiles)) {
      inputData = req.body.profiles;
      fileName = req.body.file_name || 'profiles.json';
    } else {
      return res.status(400).json({
        success: false,
        error: 'No file or data provided. Upload a file or provide rows/profiles array in request body.',
      });
    }

    const batchId = req.body.batch_id || `ESIC_MASTER_${Date.now()}`;
    const result = globalEsicAutomationEngine.profileStore.ingestExcelMaster(inputData, {
      batch_id: batchId,
      file_name: fileName,
    });

    return res.status(200).json({
      success: true,
      message: `Successfully ingested master profiles from ${fileName}`,
      ...result,
    });
  } catch (err) {
    return res.status(500).json({
      success: false,
      error: `Failed to process master upload: ${err.message}`,
    });
  }
});

/**
 * GET /template
 * Download standardized ESIC Employee Master template (CSV/Excel format)
 */
router.get('/template', (req, res) => {
  const format = String(req.query.format || 'csv').toLowerCase();

  if (format === 'xls' || format === 'xlsx') {
    const xmlContent = `<?xml version="1.0" encoding="UTF-8"?>
<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet"
 xmlns:o="urn:schemas-microsoft-com:office:office"
 xmlns:x="urn:schemas-microsoft-com:office:excel"
 xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet">
 <Worksheet ss:Name="ESIC_Employee_Master">
  <Table>
   <Row>
    <Cell><Data ss:Type="String">employee_id</Data></Cell>
    <Cell><Data ss:Type="String">employee_name</Data></Cell>
    <Cell><Data ss:Type="String">esic_number</Data></Cell>
    <Cell><Data ss:Type="String">esic_applicable</Data></Cell>
    <Cell><Data ss:Type="String">date_of_joining</Data></Cell>
    <Cell><Data ss:Type="String">date_of_exit</Data></Cell>
    <Cell><Data ss:Type="String">disability_percentage</Data></Cell>
    <Cell><Data ss:Type="String">is_grandfathered</Data></Cell>
   </Row>
   <Row>
    <Cell><Data ss:Type="String">EMP001</Data></Cell>
    <Cell><Data ss:Type="String">Aarav Sharma</Data></Cell>
    <Cell><Data ss:Type="String">3112345678</Data></Cell>
    <Cell><Data ss:Type="String">true</Data></Cell>
    <Cell><Data ss:Type="String">2024-01-01</Data></Cell>
    <Cell><Data ss:Type="String"></Data></Cell>
    <Cell><Data ss:Type="Number">0</Data></Cell>
    <Cell><Data ss:Type="String">false</Data></Cell>
   </Row>
   <Row>
    <Cell><Data ss:Type="String">EMP002</Data></Cell>
    <Cell><Data ss:Type="String">Priya Patel</Data></Cell>
    <Cell><Data ss:Type="String">3198765432</Data></Cell>
    <Cell><Data ss:Type="String">true</Data></Cell>
    <Cell><Data ss:Type="String">2024-02-15</Data></Cell>
    <Cell><Data ss:Type="String"></Data></Cell>
    <Cell><Data ss:Type="Number">45</Data></Cell>
    <Cell><Data ss:Type="String">false</Data></Cell>
   </Row>
  </Table>
 </Worksheet>
</Workbook>`;

    res.setHeader('Content-Type', 'application/vnd.ms-excel; charset=UTF-8');
    res.setHeader('Content-Disposition', 'attachment; filename="ESIC_Employee_Master.xls"');
    return res.send(xmlContent);
  }

  // Standard CSV template
  const csvContent = [
    'employee_id,employee_name,esic_number,esic_applicable,date_of_joining,date_of_exit,disability_percentage,is_grandfathered',
    'EMP001,Aarav Sharma,3112345678,true,2024-01-01,,0,false',
    'EMP002,Priya Patel,3198765432,true,2024-02-15,,45,false',
    'EMP003,Rohan Verma,3155554444,true,2023-11-01,,0,false',
  ].join('\r\n');

  res.setHeader('Content-Type', 'text/csv; charset=UTF-8');
  res.setHeader('Content-Disposition', 'attachment; filename="ESIC_Employee_Master_Template.csv"');
  return res.send(csvContent);
});

/**
 * GET /profiles
 * Returns registered employee ESIC profiles
 */
router.get('/profiles', (req, res) => {
  try {
    const period = req.query.period;
    const activeOnly = req.query.active_only === 'true';

    let profiles = [];
    if (activeOnly || period) {
      profiles = globalEsicAutomationEngine.profileStore.findActiveProfiles(period || '2026-09');
    } else {
      profiles = globalEsicAutomationEngine.profileStore.getAllProfiles();
    }

    return res.status(200).json({
      success: true,
      count: profiles.length,
      profiles,
    });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * ----------------------------------------------------------------------------
 * 2. AUTOMATION BUILDER & CALCULATION ENGINE
 * ----------------------------------------------------------------------------
 */

/**
 * POST /trigger
 * Explicitly triggers ESIC automation calculation upon Payroll Finalized
 */
router.post('/trigger', async (req, res) => {
  try {
    const {
      batch_id,
      run_id,
      period = '2026-09',
      employer_code = '31000123450000999',
      payroll_records,
    } = req.body;

    const runId = run_id || `RUN_${Date.now()}`;
    const batchId = sanitizeBatchId(batch_id) || `BATCH_ESIC_${runId}`;

    let records = payroll_records;

    // If records are not provided, synthesize from master profiles
    if (!Array.isArray(records) || records.length === 0) {
      const activeProfiles = globalEsicAutomationEngine.profileStore.findActiveProfiles(period);
      if (activeProfiles.length > 0) {
        records = activeProfiles.map((p) => ({
          employee_id: p.employee_id,
          employee_name: p.employee_name,
          esic_number: p.esic_number,
          esic_applicable: p.esic_applicable,
          gross_salary: p.disability_percentage >= 40 ? 24000 : 18500, // standard default
          days_worked: 30,
          disability_percentage: p.disability_percentage,
          disability_flag: p.disability_flag,
          is_grandfathered: p.is_grandfathered,
        }));
      } else {
        // Built-in demonstration sample if store is empty
        records = [
          {
            employee_id: 'EMP001',
            employee_name: 'Aarav Sharma',
            esic_number: '3112345678',
            esic_applicable: true,
            gross_salary: 18000,
            days_worked: 30,
            disability_percentage: 0,
          },
          {
            employee_id: 'EMP002',
            employee_name: 'Priya Patel',
            esic_number: '3198765432',
            esic_applicable: true,
            gross_salary: 23500,
            days_worked: 30,
            disability_percentage: 45, // Qualified under ₹25,000 disabled limit
          },
          {
            employee_id: 'EMP003',
            employee_name: 'Rohan Verma',
            esic_number: '3155554444',
            esic_applicable: true,
            gross_salary: 15000,
            days_worked: 28,
            disability_percentage: 0,
          },
        ];
      }
    }

    const calculationResult = await globalEsicAutomationEngine.onPayrollFinalized({
      batch_id: batchId,
      run_id: runId,
      period,
      employer_code,
      payroll_records: records,
    });

    const stepper = globalEsicAutomationEngine.getStepperState(batchId);

    // Persist batch and calculation to Firebase Firestore
    await safeFirestoreSet('esic_compliance_batches', batchId, {
      batch_id: batchId,
      run_id: runId,
      period,
      employer_code,
      covered_count: calculationResult?.totals?.total_covered_count || 0,
      total_wages: calculationResult?.totals?.total_wages || 0,
      total_challan: calculationResult?.totals?.total_contribution || 0,
      exceptions_count: calculationResult?.exceptions?.length || 0,
      current_stage: stepper?.current_stage || 'ESIC_CALCULATED',
      stepper,
      status: 'VALIDATED',
      created_at: new Date().toISOString()
    });

    return res.status(200).json({
      success: true,
      message: `ESIC calculation completed for batch ${batchId}`,
      batch_id: batchId,
      run_id: runId,
      period,
      calculation: calculationResult,
      stepper,
    });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * GET /summary/:batch_id
 * Returns metrics & statutory totals for an ESIC batch
 */
router.get('/summary/:batch_id', (req, res) => {
  try {
    const batchId = sanitizeBatchId(req.params.batch_id);
    const calcResult = globalEsicAutomationEngine.calculationResults.get(batchId);

    if (!calcResult) {
      return res.status(404).json({
        success: false,
        error: `Calculation results not found for batch ${batchId}`,
      });
    }

    const stepper = globalEsicAutomationEngine.getStepperState(batchId);
    const exceptions = globalEsicAutomationEngine.esicExceptions.get(batchId) || [];
    const tasks = globalEsicAutomationEngine.hrTasks.get(batchId) || [];
    const alerts = globalEsicAutomationEngine.hrAlerts.get(batchId) || [];

    return res.status(200).json({
      success: true,
      batch_id: batchId,
      period: calcResult.period,
      employer_code: calcResult.employer_code,
      summary: calcResult.summary,
      stepper,
      counts: {
        compliant: calcResult.compliant_records.length,
        exceptions: exceptions.length,
        unresolved_exceptions: exceptions.filter((e) => !e.resolved).length,
        hr_tasks: tasks.length,
        alerts: alerts.length,
      },
    });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * ----------------------------------------------------------------------------
 * 3. 7-STAGE VISUAL COMPLIANCE STEPPER
 * ----------------------------------------------------------------------------
 */

/**
 * GET /stepper/:batch_id
 * Retrieves current visual stepper state, stage history, and blocking status
 */
router.get('/stepper/:batch_id', (req, res) => {
  try {
    const batchId = sanitizeBatchId(req.params.batch_id);
    const state = globalEsicAutomationEngine.getStepperState(batchId);

    if (!state) {
      return res.status(404).json({
        success: false,
        error: `Stepper state not found for batch ${batchId}`,
        stages: ESIC_STEPPER_STAGES.map((s) => ({ stage: s, label: ESIC_STEPPER_LABELS[s] })),
      });
    }

    return res.status(200).json({
      success: true,
      stepper: state,
    });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * POST /stepper/:batch_id/advance
 * Advances the batch through the 7-stage visual stepper
 */
router.post('/stepper/:batch_id/advance', async (req, res) => {
  try {
    const batchId = sanitizeBatchId(req.params.batch_id);
    const { target_stage, actor = 'COMPLIANCE_LEAD', notes, force = false } = req.body;

    if (!target_stage) {
      return res.status(400).json({
        success: false,
        error: 'target_stage is required.',
        allowed_stages: ESIC_STEPPER_STAGES,
      });
    }

    try {
      if (!globalEsicAutomationEngine.stepperStates.has(batchId)) {
        await globalEsicAutomationEngine.onPayrollFinalized({
          batch_id: batchId,
          run_id: `RUN_${Date.now()}`,
          period: '2026-09',
          employer_code: '31000123450000999',
          payroll_records: [],
        });
      }

      const updatedState = globalEsicAutomationEngine.advanceStepperStage(batchId, target_stage, {
        actor,
        notes,
        force: Boolean(force),
      });

      // Persist stepper advance to Firebase Firestore
      await safeFirestoreSet('esic_compliance_batches', batchId, {
        batch_id: batchId,
        current_stage: target_stage,
        stage_label: ESIC_STEPPER_LABELS[target_stage] || target_stage,
        stepper: updatedState,
        status: target_stage === 'COMPLETED' ? 'COMPLETED' : 'VALIDATED',
        updated_at: new Date().toISOString()
      });

      return res.status(200).json({
        success: true,
        message: `Advanced batch ${batchId} to stage ${target_stage}`,
        stepper: updatedState,
      });
    } catch (advanceErr) {
      if (advanceErr.code === 'UNRESOLVED_ESIC_EXCEPTIONS') {
        return res.status(422).json({
          success: false,
          code: advanceErr.code,
          error: advanceErr.message,
          unresolved_count: advanceErr.unresolved_count,
          exceptions: advanceErr.exceptions,
        });
      }
      return res.status(400).json({
        success: false,
        error: advanceErr.message,
      });
    }
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * ----------------------------------------------------------------------------
 * 4. EXCEPTIONS, HR TASKS & ALERTS
 * ----------------------------------------------------------------------------
 */

/**
 * GET /exceptions
 * Query records in ESIC_Exceptions table
 */
router.get('/exceptions', (req, res) => {
  try {
    const batchId = req.query.batch_id ? sanitizeBatchId(req.query.batch_id) : null;
    const unresolvedOnly = req.query.unresolved_only === 'true';

    let allExceptions = [];
    if (batchId) {
      allExceptions = globalEsicAutomationEngine.esicExceptions.get(batchId) || [];
    } else {
      for (const list of globalEsicAutomationEngine.esicExceptions.values()) {
        allExceptions.push(...list);
      }
    }

    if (unresolvedOnly) {
      allExceptions = allExceptions.filter((e) => !e.resolved);
    }

    return res.status(200).json({
      success: true,
      count: allExceptions.length,
      exceptions: allExceptions,
    });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * POST /exceptions/:exception_id/resolve
 * Remediates an ESIC exception and synchronizes with HR task
 */
router.post('/exceptions/:exception_id/resolve', (req, res) => {
  try {
    const exceptionId = req.params.exception_id;
    const {
      resolved_by = 'compliance_officer',
      fix_applied = 'Data remediated and verified',
      new_esic_number,
      new_gross_salary,
    } = req.body;

    // Find the exception to get employee info
    let foundException = null;
    let foundBatchId = null;

    for (const [bId, list] of globalEsicAutomationEngine.esicExceptions.entries()) {
      const exc = list.find((e) => e.exception_id === exceptionId);
      if (exc) {
        foundException = exc;
        foundBatchId = bId;
        break;
      }
    }

    if (!foundException) {
      return res.status(404).json({
        success: false,
        error: `Exception ${exceptionId} not found in ESIC_Exceptions table.`,
      });
    }

    // Apply remediation to profile store if relevant
    if (new_esic_number && foundException.employee_id) {
      const profile = globalEsicAutomationEngine.profileStore.getProfile(foundException.employee_id);
      if (profile) {
        profile.esic_number = String(new_esic_number).trim();
        profile.updated_at = new Date().toISOString();
      }
    }

    const resolveResult = globalEsicAutomationEngine.resolveException(exceptionId, {
      resolved_by,
      fix_applied,
    });

    if (!resolveResult.success) {
      return res.status(400).json({ success: false, error: resolveResult.error });
    }

    const stepper = foundBatchId ? globalEsicAutomationEngine.getStepperState(foundBatchId) : null;

    return res.status(200).json({
      success: true,
      message: `Exception ${exceptionId} resolved successfully.`,
      exception: resolveResult.exception,
      stepper,
    });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * GET /tasks
 * Query compliance HR tasks
 */
router.get('/tasks', (req, res) => {
  try {
    const batchId = req.query.batch_id ? sanitizeBatchId(req.query.batch_id) : null;
    const status = req.query.status;

    let tasks = [];
    if (batchId) {
      tasks = globalEsicAutomationEngine.hrTasks.get(batchId) || [];
    } else {
      for (const list of globalEsicAutomationEngine.hrTasks.values()) {
        tasks.push(...list);
      }
    }

    if (status) {
      tasks = tasks.filter((t) => String(t.status).toUpperCase() === String(status).toUpperCase());
    }

    return res.status(200).json({
      success: true,
      count: tasks.length,
      tasks,
    });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * GET /alerts
 * Query real-time compliance alerts
 */
router.get('/alerts', (req, res) => {
  try {
    const batchId = req.query.batch_id ? sanitizeBatchId(req.query.batch_id) : null;

    let alerts = [];
    if (batchId) {
      alerts = globalEsicAutomationEngine.hrAlerts.get(batchId) || [];
    } else {
      for (const list of globalEsicAutomationEngine.hrAlerts.values()) {
        alerts.push(...list);
      }
    }

    return res.status(200).json({
      success: true,
      count: alerts.length,
      alerts,
    });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * ----------------------------------------------------------------------------
 * 5. OFFICIAL FILE OUTPUT (.txt & .xls)
 * ----------------------------------------------------------------------------
 */

/**
 * GET /export/:batch_id
 * Generates and downloads official ESIC_CONTRIBUTION_MONTH_YEAR.txt / .xls
 */
router.get('/export/:batch_id', async (req, res) => {
  try {
    const batchId = sanitizeBatchId(req.params.batch_id);
    const format = String(req.query.format || 'txt').toLowerCase();

    // Check if files exist or generate
    let files = globalEsicAutomationEngine.exportFiles.get(batchId);
    if (!files) {
      if (!globalEsicAutomationEngine.calculationResults.has(batchId)) {
        await globalEsicAutomationEngine.onPayrollFinalized({
          batch_id: batchId,
          run_id: `RUN_${Date.now()}`,
          period: '2026-09',
          employer_code: '31000123450000999',
          payroll_records: [],
        });
      }
      files = globalEsicAutomationEngine.generateExportFiles(batchId);
    }

    if (format === 'json') {
      return res.status(200).json({
        success: true,
        manifest: files.manifest,
        txt_filename: files.txt.file_name,
        xls_filename: files.xls.file_name,
      });
    }

    if (format === 'xls' || format === 'excel') {
      res.setHeader('Content-Type', 'application/vnd.ms-excel; charset=UTF-8');
      res.setHeader('Content-Disposition', `attachment; filename="${files.xls.file_name}"`);
      return res.send(files.xls.content);
    }

    // Default to .txt
    res.setHeader('Content-Type', 'text/plain; charset=UTF-8');
    res.setHeader('Content-Disposition', `attachment; filename="${files.txt.file_name}"`);
    return res.send(files.txt.content);
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

export default router;
