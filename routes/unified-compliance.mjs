/**
 * ============================================================================
 * KYLRX AI ENTERPRISE HRMS - UNIFIED COMPLIANCE REST API ROUTES
 * ============================================================================
 * Provides unified management across ESIC, Gratuity, and NPS schemes:
 *
 * 1. POST /orchestrate:
 *    Initiates master tri-scheme orchestration on payroll run finalization.
 *
 * 2. GET /staging/:source_payroll_id:
 *    Queries staging documents across /esic_compliance_batches,
 *    /gratuity_settlements, and /nps_compliance_batches.
 *
 * 3. GET /exceptions:
 *    Queries shared /statutory_exceptions collection with automatic UI PII masking.
 *
 * 4. GET /audit-manifest/:orchestration_id:
 *    Retrieves audit execution manifest with rule versions, timestamps, and file checksums.
 *
 * 5. POST /exceptions/:id/resolve:
 *    Cross-scheme exception resolver that syncs across Firebase and engines.
 *
 * @version 4.0.0
 * @author Kylrx AI Lead Backend Compliance Engineer
 */

import { Router } from 'express';
import {
  globalUnifiedStatutoryOrchestrator,
  STATUTORY_RULE_VERSIONS,
} from '../services/unified-statutory-orchestration-service.mjs';

const router = Router();

const sanitizeId = (id) => (id || '').replace(/[^a-zA-Z0-9_-]/g, '');

/**
 * POST /orchestrate
 * Master trigger initiating ESIC, Gratuity, and NPS workers simultaneously
 */
router.post('/orchestrate', async (req, res) => {
  try {
    const payload = req.body || {};
    const manifest = await globalUnifiedStatutoryOrchestrator.orchestratePayrollRun(payload, {
      triggered_by: req.user?.id || req.body?.triggered_by || 'api-user',
    });

    const isRaw = req.query.raw === 'true' || req.headers['x-privileged-export'] === 'true';
    const responseData = isRaw
      ? manifest
      : globalUnifiedStatutoryOrchestrator.maskForUiPresentation(manifest);

    return res.status(200).json({
      success: true,
      message: `Unified compliance orchestration completed for payroll run ${manifest.source_payroll_id}`,
      data: responseData,
    });
  } catch (err) {
    return res.status(500).json({
      success: false,
      error: { code: 'ORCHESTRATION_FAILED', message: err.message },
    });
  }
});

/**
 * GET /staging/:source_payroll_id
 * Retrieve staged batch records across the 3 dedicated Firestore collections
 */
router.get('/staging/:source_payroll_id', (req, res) => {
  try {
    const sourcePayrollId = sanitizeId(req.params.source_payroll_id);
    const isRaw = req.query.raw === 'true' || req.headers['x-privileged-export'] === 'true';

    const stagingData = globalUnifiedStatutoryOrchestrator.getStagingRecords(sourcePayrollId, {
      mask: !isRaw,
    });

    return res.status(200).json({
      success: true,
      data: stagingData,
    });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * GET /exceptions
 * Query shared statutory_exceptions collection (masked by default for UI)
 */
router.get('/exceptions', (req, res) => {
  try {
    const { scheme, source_payroll_id, unresolved_only, raw } = req.query;
    const isRaw = raw === 'true' || req.headers['x-privileged-export'] === 'true';

    const exceptions = globalUnifiedStatutoryOrchestrator.getSharedExceptions(
      {
        scheme,
        source_payroll_id: source_payroll_id ? sanitizeId(source_payroll_id) : undefined,
        unresolved_only: unresolved_only === 'true',
      },
      { mask: !isRaw }
    );

    return res.status(200).json({
      success: true,
      data: exceptions,
    });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * GET /audit-manifest/:id
 * Retrieve compliance audit execution manifest with rule versions, execution timestamps, and checksums
 */
router.get('/audit-manifest/:id', (req, res) => {
  try {
    const id = sanitizeId(req.params.id);
    const manifest = globalUnifiedStatutoryOrchestrator.executionManifests.get(id);

    if (!manifest) {
      return res.status(404).json({
        success: false,
        error: { code: 'MANIFEST_NOT_FOUND', message: `Execution manifest not found for identifier ${id}` },
      });
    }

    const isRaw = req.query.raw === 'true' || req.headers['x-privileged-export'] === 'true';
    const responseData = isRaw
      ? manifest
      : globalUnifiedStatutoryOrchestrator.maskForUiPresentation(manifest);

    return res.status(200).json({
      success: true,
      data: responseData,
    });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * POST /exceptions/:id/resolve
 * Cross-scheme exception resolution
 */
router.post('/exceptions/:id/resolve', async (req, res) => {
  try {
    const exceptionId = req.params.id;
    const result = await globalUnifiedStatutoryOrchestrator.resolveSharedException(exceptionId, req.body);

    if (!result.success) {
      return res.status(404).json({
        success: false,
        error: { code: 'EXCEPTION_NOT_FOUND', message: result.error },
      });
    }

    return res.status(200).json({
      success: true,
      message: `Statutory exception ${exceptionId} resolved across Firestore and engine stores.`,
      data: result.exception,
    });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

export default router;
