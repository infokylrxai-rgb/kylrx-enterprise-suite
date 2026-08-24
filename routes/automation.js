const express = require('express');
const router = express.Router();
const { db } = require('../config/firebase');
const eventBus = require('../services/event-bus');
const logger = require('../utils/logger');

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

// POST /api/automations/test-trigger - Manually fire a test event
router.post('/test-trigger', (req, res) => {
    try {
        const { eventName, entityId, entityType, payload } = req.body;
        
        if (!eventName || !entityId) {
            return res.status(400).json({ success: false, error: 'Missing eventName or entityId' });
        }

        const eventId = eventBus.emitEvent(eventName, entityId, entityType || 'test_entity', payload || {});
        
        res.status(200).json({ 
            success: true, 
            message: `Test event '${eventName}' fired.`,
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

module.exports = router;
