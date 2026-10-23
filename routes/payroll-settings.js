const express = require('express');
const router = express.Router();
const payrollService = require('../services/payroll-email-account-service');
const logger = require('../utils/logger');
const { verifyToken, authorize, ADMIN_HR_ROLES } = require('../middleware/authMiddleware');

router.use(verifyToken);

// Apply Admin/HR authorization to all payroll-settings routes except employee account-view
router.use((req, res, next) => {
    if (req.path.startsWith('/account-view/')) {
        return next();
    }
    return authorize(ADMIN_HR_ROLES)(req, res, next);
});

/**
 * ============================================================================
 * PAYROLL, EMAIL AND ACCOUNT VIEWS REST API (PRD Section 3)
 * ============================================================================
 */

// 1. Create & Validate Payroll Rule (PRD §3.1)
router.post('/rules', (req, res) => {
    try {
        const { rule, actor } = req.body || {};
        const createdRule = payrollService.createPayrollRule(
            rule || {},
            actor || { role: 'hr_payroll', name: 'HR Admin' }
        );

        res.status(201).json({
            success: true,
            data: createdRule,
            message: `Payroll rule '${createdRule.name}' created successfully. Status: ${createdRule.status}.`
        });
    } catch (err) {
        logger.error('[PayrollAPI] Create rule error:', err.message);
        res.status(400).json({ success: false, error: err.message });
    }
});

// 2. Approve & Activate Payroll Rule (PRD §3.1 & §3.4: Maker-Checker separation)
router.post('/rules/:ruleId/approve', (req, res) => {
    try {
        const { ruleId } = req.params;
        const { approver, options } = req.body || {};

        const activatedRule = payrollService.approveAndActivateRule(
            ruleId,
            approver || { role: 'super_admin', name: 'Super Admin' },
            options || {}
        );

        res.status(200).json({
            success: true,
            data: activatedRule,
            message: `Payroll rule '${ruleId}' approved and activated.`
        });
    } catch (err) {
        logger.error('[PayrollAPI] Approve rule error:', err.message);
        res.status(403).json({ success: false, error: err.message });
    }
});

// 3. Query All Payroll Rules (PRD §3.1)
router.get('/rules', (req, res) => {
    try {
        const { status, event } = req.query;
        const rules = payrollService.getAllRules({ status, event });
        res.status(200).json({ success: true, data: rules, total: rules.length });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// 4. Query Rule by ID
router.get('/rules/:ruleId', (req, res) => {
    try {
        const { ruleId } = req.params;
        const rule = payrollService.getRuleById(ruleId);
        if (!rule) {
            return res.status(404).json({ success: false, error: `Rule '${ruleId}' not found.` });
        }
        res.status(200).json({ success: true, data: rule });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// 5. Approved Email Templates Registry (PRD §3.1)
router.get('/templates', (req, res) => {
    try {
        const templates = payrollService.getApprovedTemplates();
        res.status(200).json({ success: true, data: templates, total: templates.length });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// 6. Deduction-Related Notification Preview & Distinction (PRD §3.2)
router.post('/deduction-notifications/preview', (req, res) => {
    try {
        const { employeeId, deductionId, referenceDate, offsetDays, actor } = req.body || {};
        const preview = payrollService.generateDeductionNotificationPreview(
            { employeeId, deductionId, referenceDate, offsetDays },
            actor || { role: 'hr_payroll', name: 'HR Admin' }
        );

        res.status(200).json({
            success: true,
            data: preview,
            message: 'Deduction notification reminder generated with explicit non-financial distinction notice.'
        });
    } catch (err) {
        logger.error('[PayrollAPI] Deduction preview error:', err.message);
        res.status(400).json({ success: false, error: err.message });
    }
});

// 7. Role-Based Account View with Data Masking (PRD §3.3)
router.get('/account-view/:employeeId', (req, res) => {
    try {
        const { employeeId } = req.params;
        const userRole = (req.user && req.user.role ? req.user.role : '').toLowerCase();

        // Employee-facing reads must be restricted to req.user.id
        if (userRole === 'employee' && employeeId !== req.user.id) {
            return res.status(403).json({
                success: false,
                error: 'Unauthorized: Employees may only view their own account view'
            });
        }

        const actor = {
            id: req.user?.id || req.query.actorId || req.headers['x-user-id'] || 'EMP-1001',
            role: req.user?.role || req.query.actorRole || req.headers['x-user-role'] || 'employee',
            name: req.user?.name || req.query.actorName || 'Current User'
        };

        const accountData = payrollService.getAccountView(employeeId, actor);
        res.status(200).json({ success: true, data: accountData });
    } catch (err) {
        logger.error('[PayrollAPI] Account view error:', err.message);
        if (err.message && (err.message.includes('not found') || err.message.includes('Account record'))) {
            return res.status(404).json({ success: false, error: err.message });
        }
        res.status(403).json({ success: false, error: err.message });
    }
});

// 8. Account View Access Audit Trail (PRD §3.3)
router.get('/account-view-audits', (req, res) => {
    try {
        const limit = req.query.limit ? parseInt(req.query.limit, 10) : 50;
        const logs = payrollService.getAccountViewAuditLogs(limit);
        res.status(200).json({ success: true, data: logs, total: logs.length });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// 9. Payroll Change History (PRD §3.4)
router.get('/change-history', (req, res) => {
    try {
        const { ruleId } = req.query;
        const history = payrollService.getChangeHistory(ruleId);
        res.status(200).json({ success: true, data: history, total: history.length });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// 10. Client Approval Policy Update (PRD §3.4)
router.put('/client-policy', (req, res) => {
    try {
        const { policy, actor } = req.body || {};
        const updatedPolicy = payrollService.updateClientApprovalPolicy(
            policy || {},
            actor || { role: 'super_admin', name: 'Admin' }
        );

        res.status(200).json({
            success: true,
            data: updatedPolicy,
            message: 'Client approval policy updated.'
        });
    } catch (err) {
        logger.error('[PayrollAPI] Policy update error:', err.message);
        res.status(400).json({ success: false, error: err.message });
    }
});

// 11. Core User Roles Matrix (PRD §3.5)
router.get('/roles-matrix', (req, res) => {
    try {
        const matrix = payrollService.getRoleMatrix();
        res.status(200).json({ success: true, data: matrix });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

module.exports = router;
