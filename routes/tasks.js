const express = require('express');
const router = express.Router();
const { db } = require('../config/firebase');
const automationEngine = require('../services/automation-engine');
const logger = require('../utils/logger');

// POST /api/tasks/:id/action - Resolve a pending task (approve/reject)
router.post('/:id/action', async (req, res) => {
    try {
        const taskId = req.params.id;
        const { action, notes } = req.body;

        if (!['approved', 'rejected'].includes(action)) {
            return res.status(400).json({ success: false, error: 'Invalid action. Must be approved or rejected.' });
        }

        const taskRef = db.collection('tasks').doc(taskId);
        const taskDoc = await taskRef.get();

        if (!taskDoc.exists) {
            return res.status(404).json({ success: false, error: 'Task not found.' });
        }

        const taskData = taskDoc.data();

        if (taskData.status !== 'pending') {
            return res.status(400).json({ success: false, error: 'Task is already resolved.' });
        }

        const resolvedAt = new Date().toISOString();

        // 1. Update task record
        await taskRef.update({
            status: action,
            resolved_at: resolvedAt,
            resolution_notes: notes || '',
            // resolved_by could be fetched from req.user if authentication middleware is used
        });

        logger.info(`[Tasks API] Task ${taskId} marked as ${action}.`);

        // 2. Resume automation run if it belongs to one
        if (taskData.run_id) {
            try {
                await automationEngine.resumePipeline(taskData.run_id, {
                    task_id: taskId,
                    action,
                    notes,
                    resolved_at: resolvedAt
                });
            } catch (resumeError) {
                logger.error(`[Tasks API] Error resuming automation run ${taskData.run_id}:`, resumeError);
                // Return 207 Multi-Status or a specific warning that the task saved but engine failed to resume
                return res.status(500).json({ 
                    success: false, 
                    message: 'Task resolved, but automation engine failed to resume.',
                    error: resumeError.message
                });
            }
        }

        res.status(200).json({ success: true, message: `Task successfully ${action}` });
    } catch (error) {
        logger.error('Error resolving task:', error);
        res.status(500).json({ success: false, error: 'Failed to resolve task' });
    }
});

module.exports = router;
