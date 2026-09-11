const express = require('express');
const router = express.Router();
const kylrxHROS = require('../services/kylrx-hr-os');
const logger = require('../utils/logger');

/**
 * GET /api/hr-os/manifest
 * Returns complete OS architecture manifest, 4 pillars, and 6 capabilities
 */
router.get('/manifest', (req, res) => {
    try {
        const manifest = kylrxHROS.getOperatingSystemManifest();
        res.json({
            success: true,
            manifest
        });
    } catch (error) {
        logger.error('[HR-OS API] Error fetching manifest:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

/**
 * GET /api/hr-os/status
 * Real-time operational health check and metrics
 */
router.get('/status', (req, res) => {
    try {
        const manifest = kylrxHROS.getOperatingSystemManifest();
        res.json({
            success: true,
            system: manifest.system,
            version: manifest.version,
            motto: manifest.motto,
            status: manifest.status,
            activeModulesCount: manifest.modules.count,
            registeredModules: manifest.modules.registered,
            subsystems: manifest.subsystems,
            timestamp: manifest.timestamp
        });
    } catch (error) {
        logger.error('[HR-OS API] Error fetching status:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

/**
 * GET /api/hr-os/verify-pillars
 * Verifies compliance with Configure Once → Automate Everything → Track Everything → Preserve History
 */
router.get('/verify-pillars', (req, res) => {
    try {
        const verification = kylrxHROS.verifyPillars();
        res.json({
            success: true,
            ...verification
        });
    } catch (error) {
        logger.error('[HR-OS API] Error verifying pillars:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

/**
 * POST /api/hr-os/event
 * Ingest standardized HR event from ANY module into the central engine
 */
router.post('/event', async (req, res) => {
    try {
        const { eventName, payload, metadata } = req.body;
        if (!eventName) {
            return res.status(400).json({ success: false, error: 'eventName is required' });
        }

        const result = await kylrxHROS.dispatchHREvent(eventName, payload || {}, metadata || {});
        res.json({
            success: true,
            ...result
        });
    } catch (error) {
        logger.error('[HR-OS API] Error dispatching event:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

/**
 * POST /api/hr-os/lifecycle-demo
 * Executes unified HR lifecycle demonstrating all 6 subsystems operating in tandem
 */
router.post('/lifecycle-demo', async (req, res) => {
    try {
        const employeeProfile = req.body || {};
        const result = await kylrxHROS.executeUnifiedHRLifecycle(employeeProfile);
        res.json(result);
    } catch (error) {
        logger.error('[HR-OS API] Error executing unified lifecycle demo:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

module.exports = router;
