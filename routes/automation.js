const express = require('express');
const router = express.Router();
const { db } = require('../config/firebase');
const eventBus = require('../services/event-bus');
const moduleRegistry = require('../services/automation-module-registry');
const logger = require('../utils/logger');

// GET /api/automations/modules - Return discovery schema for all registered HR modules
router.get('/modules', (req, res) => {
    try {
        const catalog = moduleRegistry.getSchemaCatalog();
        res.status(200).json({
            success: true,
            totalModules: catalog.length,
            modules: catalog
        });
    } catch (error) {
        logger.error('[AutomationRoutes] Error fetching module catalog:', error);
        res.status(500).json({ success: false, error: 'Failed to fetch module catalog' });
    }
});

// POST /api/automations - Create or update a workflow definition
router.post('/', async (req, res) => {
    try {
        const payload = req.body;
        // Basic validation
        if (!payload.name || !payload.trigger_event || !payload.pipeline) {
            return res.status(400).json({ success: false, error: 'Missing required fields: name, trigger_event, pipeline' });
        }

        const automationRef = db.collection('automations').doc(payload.id || undefined); // let firestore auto-id if missing
        const finalId = payload.id || automationRef.id;

        const data = {
            ...payload,
            updated_at: new Date().toISOString(),
            status: payload.status || 'active'
        };

        await automationRef.set(data, { merge: true });

        res.status(200).json({ success: true, id: finalId, message: 'Automation saved successfully' });
    } catch (error) {
        logger.error('Error saving automation:', error);
        res.status(500).json({ success: false, error: 'Failed to save automation' });
    }
});

// GET /api/automations - List all workflows
router.get('/', async (req, res) => {
    try {
        const snapshot = await db.collection('automations').get();
        const automations = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        res.status(200).json({ success: true, data: automations });
    } catch (error) {
        logger.error('Error fetching automations:', error);
        res.status(500).json({ success: false, error: 'Failed to fetch automations' });
    }
});

// POST /api/automations/test-trigger - Manually fire a test event through the unified pipeline
router.post('/test-trigger', (req, res) => {
    try {
        const { eventName, entityId, entityType, payload } = req.body;
        
        if (!eventName || !entityId) {
            return res.status(400).json({ success: false, error: 'Missing eventName or entityId' });
        }

        const eventId = eventBus.emitEvent(eventName, entityId, entityType || 'test_entity', payload || {});
        
        res.status(200).json({ 
            success: true, 
            message: `Test event '${eventName}' dispatched to Unified Automation Engine.`,
            eventId
        });
    } catch (error) {
        logger.error('Error firing test event:', error);
        res.status(500).json({ success: false, error: 'Failed to fire test event' });
    }
});

// GET /api/automations/runs/:id - Fetch real-time run logs and execution status
router.get('/runs/:id', async (req, res) => {
    try {
        const runId = req.params.id;
        const runDoc = await db.collection('automation_runs').doc(runId).get();

        if (!runDoc.exists) {
            return res.status(404).json({ success: false, error: 'Automation run not found' });
        }

        res.status(200).json({ success: true, data: runDoc.data() });
    } catch (error) {
        logger.error('Error fetching run status:', error);
        res.status(500).json({ success: false, error: 'Failed to fetch run status' });
    }
});

// GET /api/automations/audit-logs - Query stage 8 immutable audit logs
router.get('/audit-logs', async (req, res) => {
    try {
        const limit = parseInt(req.query.limit, 10) || 50;
        let query = db.collection('automation_audit_logs');
        
        if (req.query.runId) {
            query = query.where('runId', '==', req.query.runId);
        }
        if (req.query.automationId) {
            query = query.where('automationId', '==', req.query.automationId);
        }

        const snapshot = await query.limit(limit).get();
        const logs = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));

        res.status(200).json({ success: true, count: logs.length, data: logs });
    } catch (error) {
        logger.error('Error fetching audit logs:', error);
        res.status(500).json({ success: false, error: 'Failed to fetch audit logs' });
    }
});

module.exports = router;
