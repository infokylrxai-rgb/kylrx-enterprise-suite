const express = require('express');
const router = express.Router();
const logger = require('../utils/logger');
const { rawCollection } = require('../config/firebase');
const { orgDocs, LEGACY_ORG_ID } = require('../config/tenant');
const { verifyToken, authorize, ADMIN_HR_ROLES } = require('../middleware/authMiddleware');
const ops = require('../services/operations-intel-service');

router.use(verifyToken);
router.use(authorize(ADMIN_HR_ROLES));

/**
 * Operational Dashboard (operational-dashboard.html): the six finance reports and the AI Ops
 * Review for the caller's organization. Read-only.
 */

function orgOf(req) {
    return req.tenantOrgId || (req.user && req.user.orgId) || LEGACY_ORG_ID;
}

async function reports(orgId) {
    const read = (name, max = 500) => orgDocs(rawCollection, name, orgId, max);
    const [runs, paymentBatches, disbursementBatches, legacyBatches, statutory, compliance, returns, recons, audit] = await Promise.all([
        read('payroll_runs', 300),
        read('payment_batches'),
        read('disbursement_batches'),
        read('payroll_disbursement_batches'),
        read('statutory_exceptions'),
        read('compliance_exceptions'),
        read('compliance_returns'),
        read('bank_reconciliations', 2000),
        read('audit_logs', 1000)
    ]);
    return ops.normalise({
        runs,
        batches: [...paymentBatches, ...disbursementBatches, ...legacyBatches],
        exceptions: [...statutory, ...compliance],
        returns,
        recons,
        audit
    });
}

// GET /api/operations/overview - all six reports, KPIs and the AI Ops Review
router.get('/overview', async (req, res) => {
    try {
        const data = await reports(orgOf(req));
        const reviewed = await ops.summarise(ops.review(data));
        const settled = data.reconciliation.filter(r => r.status === 'PAID').reduce((s, r) => s + r.paid_amount, 0);
        res.json({
            success: true,
            data: {
                ...data,
                kpis: {
                    disbursed: data.disbursement.filter(r => /FINAL|PAID|LOCKED|APPROVED/.test(r.status)).reduce((s, r) => s + r.net_salary, 0),
                    settled,
                    openExceptions: data.exceptions.filter(e => !/RESOLVED|CLOSED|WAIVED/.test(e.status)).length,
                    discrepancy: Math.abs(data.reconciliation.reduce((s, r) => s + r.difference, 0))
                },
                review: reviewed,
                aiConfigured: ops.aiConfigured(),
                generatedAt: new Date().toISOString()
            }
        });
    } catch (err) {
        logger.error('[OperationsAPI] Overview error:', err.message);
        res.status(500).json({ success: false, error: err.message, message: err.message });
    }
});

module.exports = router;
