const express = require('express');
const router = express.Router();
const recruitmentIntegrationService = require('../services/recruitment-integration-service');
const logger = require('../utils/logger');

/**
 * GET /api/integrations/recruitment
 * Returns integration status, pricing (₹10,000/yr), and unbundled notice
 */
router.get('/recruitment', (req, res) => {
    try {
        const config = recruitmentIntegrationService.getIntegrationConfig();
        res.json({
            success: true,
            integration: config
        });
    } catch (error) {
        logger.error('[IntegrationsAPI] Failed to get recruitment integration config:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

/**
 * POST /api/integrations/recruitment/toggle
 * Enables or disables the ₹10k/yr recruitment integration
 */
router.post('/recruitment/toggle', async (req, res) => {
    try {
        const { enabled, actor = 'Super Admin', notes = '' } = req.body;
        if (typeof enabled !== 'boolean') {
            return res.status(400).json({ success: false, error: 'Field "enabled" (boolean) is required.' });
        }
        const updated = await recruitmentIntegrationService.setIntegrationStatus(enabled, { actor, notes });
        res.json({
            success: true,
            message: `Recruitment Flow integration is now ${enabled ? 'enabled' : 'disabled'}.`,
            integration: updated
        });
    } catch (error) {
        logger.error('[IntegrationsAPI] Failed to toggle recruitment integration:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

/**
 * GET /api/integrations/plans
 * Returns subscription catalog showing General HRMS base plans vs. separate Add-on integrations
 */
router.get('/plans', (req, res) => {
    try {
        const catalog = recruitmentIntegrationService.getPlansCatalog();
        res.json({
            success: true,
            catalog,
            recruitmentAddOnPolicy: {
                annualPrice: 10000,
                currency: 'INR',
                priceDisplay: '₹10,000 / year',
                bundledInGeneralHRMS: false,
                notice: 'Recruitment Flow is maintained as an optional integration add-on at ₹10,000/year and is not included in general HRMS plans.'
            }
        });
    } catch (error) {
        logger.error('[IntegrationsAPI] Failed to get plans catalog:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

module.exports = router;
