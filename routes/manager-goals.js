const express = require('express');
const router = express.Router();
const managerGoalsEngine = require('../services/manager-goals-engine');
const logger = require('../utils/logger');
const { verifyToken } = require('../middleware/authMiddleware');

router.use(verifyToken);

/**
 * Manager Goals REST API Router
 * Requirement 1.1 Manager Goal Management
 */

// GET /api/manager-goals/stats/summary - Summary statistics for manager KPIs
router.get('/stats/summary', (req, res) => {
    try {
        const { ownerId } = req.query;
        const stats = managerGoalsEngine.getGoalStatistics(ownerId);
        res.status(200).json({ success: true, data: stats });
    } catch (error) {
        logger.error('[ManagerGoalsAPI] Error fetching stats:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// GET /api/manager-goals - List goals with optional filters
router.get('/', (req, res) => {
    try {
        const { ownerId, status, category, search } = req.query;
        const goals = managerGoalsEngine.listGoals({ ownerId, status, category, search });
        res.status(200).json({ success: true, data: goals, total: goals.length });
    } catch (error) {
        logger.error('[ManagerGoalsAPI] Error listing goals:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// GET /api/manager-goals/:id - Get single goal
router.get('/:id', (req, res) => {
    try {
        const goal = managerGoalsEngine.getGoal(req.params.id);
        res.status(200).json({ success: true, data: goal });
    } catch (error) {
        logger.error(`[ManagerGoalsAPI] Error getting goal ${req.params.id}:`, error);
        res.status(404).json({ success: false, error: error.message });
    }
});

// GET /api/manager-goals/:id/history - Get immutable audit trail
router.get('/:id/history', (req, res) => {
    try {
        const history = managerGoalsEngine.getGoalHistory(req.params.id);
        res.status(200).json({ success: true, data: history, total: history.length });
    } catch (error) {
        logger.error(`[ManagerGoalsAPI] Error getting goal history ${req.params.id}:`, error);
        res.status(404).json({ success: false, error: error.message });
    }
});

// POST /api/manager-goals - Create goal
router.post('/', (req, res) => {
    try {
        const { title, description, outcome, category, measurement, schedule, status, progress, templateId, actor } = req.body;
        if (!title) {
            return res.status(400).json({ success: false, error: 'Goal title is required.' });
        }

        const newGoal = managerGoalsEngine.createGoal(
            { title, description, outcome, category, measurement, schedule, status, progress, templateId },
            actor || { name: 'Manager', role: 'Department Manager' }
        );

        res.status(201).json({
            success: true,
            data: newGoal,
            message: `Goal "${newGoal.title}" created successfully.`
        });
    } catch (error) {
        logger.error('[ManagerGoalsAPI] Error creating goal:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// PUT /api/manager-goals/:id - Update goal details
router.put('/:id', (req, res) => {
    try {
        const { updates, actor } = req.body;
        const goal = managerGoalsEngine.updateGoal(req.params.id, updates || req.body, actor);
        res.status(200).json({
            success: true,
            data: goal,
            message: `Goal "${goal.title}" updated successfully.`
        });
    } catch (error) {
        logger.error(`[ManagerGoalsAPI] Error updating goal ${req.params.id}:`, error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// PATCH /api/manager-goals/:id/progress - Update progress % and notes
router.patch('/:id/progress', (req, res) => {
    try {
        const { progress, note, currentValue, actor } = req.body;
        if (progress === undefined) {
            return res.status(400).json({ success: false, error: 'Progress value is required.' });
        }

        const goal = managerGoalsEngine.updateProgress(
            req.params.id,
            progress,
            note || '',
            actor || { name: 'Manager', role: 'Department Manager' },
            currentValue
        );

        res.status(200).json({
            success: true,
            data: goal,
            message: `Progress updated to ${goal.progress}%.`
        });
    } catch (error) {
        logger.error(`[ManagerGoalsAPI] Error updating progress for ${req.params.id}:`, error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// POST /api/manager-goals/:id/action - Manage goal status (pause, resume, complete, archive)
router.post('/:id/action', (req, res) => {
    try {
        const { action, reason, notes, actor } = req.body;
        let goal;

        switch (action) {
            case 'pause':
                goal = managerGoalsEngine.pauseGoal(req.params.id, reason, actor);
                break;
            case 'resume':
                goal = managerGoalsEngine.resumeGoal(req.params.id, actor);
                break;
            case 'complete':
                goal = managerGoalsEngine.completeGoal(req.params.id, notes, actor);
                break;
            case 'archive':
                goal = managerGoalsEngine.archiveGoal(req.params.id, actor);
                break;
            default:
                return res.status(400).json({
                    success: false,
                    error: `Invalid action "${action}". Allowed: pause, resume, complete, archive.`
                });
        }

        res.status(200).json({
            success: true,
            data: goal,
            message: `Goal status updated to "${goal.status}".`
        });
    } catch (error) {
        logger.error(`[ManagerGoalsAPI] Error executing action on ${req.params.id}:`, error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// POST /api/manager-goals/:id/milestones/:mId/toggle - Toggle milestone completion
router.post('/:id/milestones/:mId/toggle', (req, res) => {
    try {
        const { actor } = req.body;
        const goal = managerGoalsEngine.toggleMilestone(req.params.id, req.params.mId, actor);
        res.status(200).json({
            success: true,
            data: goal,
            message: `Milestone status toggled.`
        });
    } catch (error) {
        logger.error(`[ManagerGoalsAPI] Error toggling milestone in ${req.params.id}:`, error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// POST /api/manager-goals/:id/notes - Add check-in note to history
router.post('/:id/notes', (req, res) => {
    try {
        const { note, actor } = req.body;
        if (!note || !note.trim()) {
            return res.status(400).json({ success: false, error: 'Note text is required.' });
        }

        const entry = managerGoalsEngine.addCheckInNote(req.params.id, note, actor);
        res.status(201).json({
            success: true,
            data: entry,
            message: 'Check-in note recorded in goal history.'
        });
    } catch (error) {
        logger.error(`[ManagerGoalsAPI] Error adding check-in note to ${req.params.id}:`, error);
        res.status(500).json({ success: false, error: error.message });
    }
});

module.exports = router;
