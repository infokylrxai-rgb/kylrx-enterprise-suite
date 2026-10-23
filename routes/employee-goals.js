const express = require('express');
const router = express.Router();
const employeeGoalsEngine = require('../services/employee-goals-engine');
const logger = require('../utils/logger');
const { verifyToken } = require('../middleware/authMiddleware');

router.use(verifyToken);

/**
 * Employee Goals REST API Router
 * Requirement 1.1 Goal Management for Employees
 */

// GET /api/employee-goals/stats/summary - Summary statistics for employee KPIs
router.get('/stats/summary', (req, res) => {
    try {
        const { ownerId } = req.query;
        const stats = employeeGoalsEngine.getGoalStatistics(ownerId);
        res.status(200).json({ success: true, data: stats });
    } catch (error) {
        logger.error('[EmployeeGoalsAPI] Error fetching stats:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// GET /api/employee-goals - List goals with optional filters
router.get('/', (req, res) => {
    try {
        const { ownerId, status, category, search } = req.query;
        const goals = employeeGoalsEngine.listGoals({ ownerId, status, category, search });
        res.status(200).json({ success: true, data: goals, total: goals.length });
    } catch (error) {
        logger.error('[EmployeeGoalsAPI] Error listing goals:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// GET /api/employee-goals/:id - Get single goal
router.get('/:id', (req, res) => {
    try {
        const goal = employeeGoalsEngine.getGoal(req.params.id);
        res.status(200).json({ success: true, data: goal });
    } catch (error) {
        logger.error(`[EmployeeGoalsAPI] Error getting goal ${req.params.id}:`, error);
        res.status(404).json({ success: false, error: error.message });
    }
});

// GET /api/employee-goals/:id/history - Get immutable audit trail
router.get('/:id/history', (req, res) => {
    try {
        const history = employeeGoalsEngine.getGoalHistory(req.params.id);
        res.status(200).json({ success: true, data: history, total: history.length });
    } catch (error) {
        logger.error(`[EmployeeGoalsAPI] Error getting goal history ${req.params.id}:`, error);
        res.status(404).json({ success: false, error: error.message });
    }
});

// POST /api/employee-goals - Create goal
router.post('/', (req, res) => {
    try {
        const { title, description, outcome, category, measurement, schedule, status, progress, templateId, actor, owner } = req.body;
        if (!title) {
            return res.status(400).json({ success: false, error: 'Goal title is required.' });
        }

        const newGoal = employeeGoalsEngine.createGoal(
            { title, description, outcome, category, measurement, schedule, status, progress, templateId, owner },
            actor || { name: 'Employee', role: 'Software Engineer' }
        );

        res.status(201).json({
            success: true,
            data: newGoal,
            message: `Goal "${newGoal.title}" created successfully.`
        });
    } catch (error) {
        logger.error('[EmployeeGoalsAPI] Error creating goal:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// PUT /api/employee-goals/:id - Update goal details (Manage: Edit)
router.put('/:id', (req, res) => {
    try {
        const { updates, actor } = req.body;
        const goal = employeeGoalsEngine.updateGoal(req.params.id, updates || req.body, actor);
        res.status(200).json({
            success: true,
            data: goal,
            message: `Goal "${goal.title}" updated successfully.`
        });
    } catch (error) {
        logger.error(`[EmployeeGoalsAPI] Error updating goal ${req.params.id}:`, error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// PATCH /api/employee-goals/:id/progress - Update progress % and notes (Track)
router.patch('/:id/progress', (req, res) => {
    try {
        const { progress, notes, actor, currentValue } = req.body;
        if (progress === undefined || progress === null) {
            return res.status(400).json({ success: false, error: 'Progress value is required.' });
        }

        const goal = employeeGoalsEngine.updateProgress(
            req.params.id,
            Number(progress),
            notes || '',
            actor,
            currentValue
        );

        res.status(200).json({
            success: true,
            data: goal,
            message: `Goal progress updated to ${goal.progress}%.`
        });
    } catch (error) {
        logger.error(`[EmployeeGoalsAPI] Error updating progress on goal ${req.params.id}:`, error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// PATCH /api/employee-goals/:id/status - Update lifecycle status (Manage)
router.patch('/:id/status', (req, res) => {
    try {
        const { status, reason, actor } = req.body;
        if (!status) {
            return res.status(400).json({ success: false, error: 'Status value is required.' });
        }

        const goal = employeeGoalsEngine.updateStatus(req.params.id, status, reason, actor);
        res.status(200).json({
            success: true,
            data: goal,
            message: `Goal status updated to ${goal.status}.`
        });
    } catch (error) {
        logger.error(`[EmployeeGoalsAPI] Error updating status on goal ${req.params.id}:`, error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// POST /api/employee-goals/:id/milestones/:milestoneId/toggle - Toggle milestone completion (Measure)
router.post('/:id/milestones/:milestoneId/toggle', (req, res) => {
    try {
        const { actor } = req.body;
        const goal = employeeGoalsEngine.toggleMilestone(req.params.id, req.params.milestoneId, actor);
        res.status(200).json({
            success: true,
            data: goal,
            message: `Milestone toggled successfully.`
        });
    } catch (error) {
        logger.error(`[EmployeeGoalsAPI] Error toggling milestone ${req.params.milestoneId} on goal ${req.params.id}:`, error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// POST /api/employee-goals/:id/notes - Add check-in note to history
router.post('/:id/notes', (req, res) => {
    try {
        const { note, actor } = req.body;
        if (!note || !note.trim()) {
            return res.status(400).json({ success: false, error: 'Note text is required.' });
        }

        const historyEntry = employeeGoalsEngine.addCheckInNote(req.params.id, note.trim(), actor);
        res.status(201).json({
            success: true,
            data: historyEntry,
            message: 'Check-in note added to history.'
        });
    } catch (error) {
        logger.error(`[EmployeeGoalsAPI] Error adding check-in note to goal ${req.params.id}:`, error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// DELETE /api/employee-goals/:id - Archive goal (Manage)
router.delete('/:id', (req, res) => {
    try {
        const { actor } = req.body || {};
        const goal = employeeGoalsEngine.archiveGoal(req.params.id, actor);
        res.status(200).json({
            success: true,
            data: goal,
            message: `Goal "${goal.title}" archived.`
        });
    } catch (error) {
        logger.error(`[EmployeeGoalsAPI] Error archiving goal ${req.params.id}:`, error);
        res.status(500).json({ success: false, error: error.message });
    }
});

module.exports = router;
