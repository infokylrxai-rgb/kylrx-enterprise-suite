const express = require('express');
const router = express.Router();
const logger = require('../utils/logger');
const { admin, rawCollection } = require('../config/firebase');
const { orgDocs, LEGACY_ORG_ID } = require('../config/tenant');
const { verifyToken, authorize, ADMIN_HR_ROLES } = require('../middleware/authMiddleware');
const intel = require('../services/hr-console-intel-service');

router.use(verifyToken);
router.use(authorize(ADMIN_HR_ROLES));

/**
 * Strategic HR Console (admin-hr-console.html): workforce metrics, the recruitment pipeline
 * with AI Copilot assessments, retention risks and pipeline insights — all from this
 * organization's candidates, users, exit cases and EODs. Read-only.
 */

function orgOf(req) {
    return req.tenantOrgId || (req.user && req.user.orgId) || LEGACY_ORG_ID;
}

const toIso = (v) => {
    if (!v) return null;
    if (typeof v.toDate === 'function') return v.toDate().toISOString();
    if (v._seconds !== undefined) return new Date(v._seconds * 1000).toISOString();
    return v;
};

async function signIns(uids) {
    const map = new Map();
    for (let i = 0; i < uids.length; i += 100) {
        try {
            const { users } = await admin.auth().getUsers(uids.slice(i, i + 100).map(uid => ({ uid })));
            users.forEach(u => { if (u.metadata && u.metadata.lastSignInTime) map.set(u.uid, Date.parse(u.metadata.lastSignInTime)); });
        } catch (err) {
            logger.warn(`[HrConsoleAPI] Sign-in lookup notice: ${err.message}`);
        }
    }
    return map;
}

// GET /api/hr-console/overview
router.get('/overview', async (req, res) => {
    try {
        const orgId = orgOf(req);
        const [users, exits, eods, candidatesRaw] = await Promise.all([
            orgDocs(rawCollection, 'users', orgId, 2000),
            orgDocs(rawCollection, 'employee_exits', orgId, 2000),
            orgDocs(rawCollection, 'employee_eods', orgId, 3000),
            orgDocs(rawCollection, 'candidates', orgId, 1000)
        ]);
        const reviewedEods = eods.filter(e => /^reviewed$/i.test(String(e.status || '')));
        const sign = await signIns([...new Set(users.map(u => u.uid || u.id))]);
        const candidates = candidatesRaw.filter(c => c.status !== 'archived' && c.status !== 'deleted');

        // Interview rounds (ratings/feedback) for the Copilot
        const interviews = await Promise.all(candidates.map(c =>
            rawCollection('candidates').doc(c.id).collection('interviews').get()
                .then(s => s.docs.map(d => d.data()))
                .catch(() => [])
        ));
        const assessed = candidates.map((c, i) => ({
            id: c.id,
            name: c.name || c.email || 'Candidate',
            role: c.role || '',
            department: c.department || '',
            source: c.source || '',
            stage: intel.STAGES.includes(c.stage) ? c.stage : 'Applied',
            createdAt: toIso(c.createdAt),
            interviewCount: interviews[i].length,
            copilot: intel.assessCandidate(c, interviews[i])
        })).sort((a, b) => b.copilot.priority - a.copilot.priority);

        const metrics = intel.workforceMetrics({ users, exits, eods: reviewedEods, signIns: sign });
        const pipeline = intel.pipelineInsights(candidates, assessed.map(a => a.copilot));
        const departments = [...new Set([...users.map(u => u.departmentName || u.department), ...candidates.map(c => c.department)].filter(Boolean))].sort();

        res.json({
            success: true,
            data: {
                metrics,
                candidates: assessed,
                activeCandidates: assessed.filter(a => a.stage !== 'Hired' && a.stage !== 'Rejected').length,
                departmentsWithOpenings: [...new Set(assessed.filter(a => a.stage !== 'Hired' && a.stage !== 'Rejected').map(a => a.department).filter(Boolean))].length,
                pipeline,
                retention: intel.retentionRisks({ users, exits, eods: reviewedEods, signIns: sign }).slice(0, 15),
                departments
            }
        });
    } catch (err) {
        logger.error('[HrConsoleAPI] Overview error:', err.message);
        res.status(500).json({ success: false, error: err.message, message: err.message });
    }
});

module.exports = router;
