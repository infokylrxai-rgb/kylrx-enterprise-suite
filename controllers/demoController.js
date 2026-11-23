const { db, getAuth } = require('../config/firebase');
const logger = require('../utils/logger');
const { DEMO_ORG_ID, DEMO_ROLES, demoEnabled } = require('../config/demo');

// Role claim written to the token for each demo button (same spelling the signup flow uses)
const CLAIM_ROLE = { admin: 'super_admin', hrms: 'HRMS', manager: 'Manager', employee: 'Employee' };

/** GET /api/public-config: what the login pages may show */
exports.publicConfig = (req, res) => {
    res.json({ demoMode: demoEnabled() });
};

/**
 * POST /api/auth/demo-login { role }
 * 404 unless demo mode is on. Returns a Firebase custom token for the seeded demo user of that role in the
 * demo organization. The user is looked up INSIDE org_demo and must be flagged isDemo, and the token's orgId
 * is the constant org_demo, so it cannot be pointed at any other organization.
 */
exports.demoLogin = async (req, res, next) => {
    try {
        if (!demoEnabled()) return res.sendStatus(404);
        const role = String((req.body && req.body.role) || '').toLowerCase();
        if (!DEMO_ROLES.includes(role)) {
            return res.status(400).json({ success: false, error: `role must be one of: ${DEMO_ROLES.join(', ')}` });
        }

        const snap = await db.collection('users').where('orgId', '==', DEMO_ORG_ID).where('demoRole', '==', role).limit(1).get();
        const doc = snap.docs[0];
        if (!doc || doc.data().isDemo !== true || doc.data().orgId !== DEMO_ORG_ID) {
            logger.warn(`[DEMO MODE] demo-login for "${role}" refused: no seeded demo user (run npm run seed:demo)`);
            return res.status(503).json({ success: false, error: 'Demo users are not set up on this server. Run: npm run seed:demo' });
        }

        const claims = { role: CLAIM_ROLE[role], orgId: DEMO_ORG_ID, demo: true };
        if (role === 'admin') claims.super_admin = true;
        const customToken = await getAuth().createCustomToken(doc.id, claims);

        logger.warn(`[DEMO MODE] demo-login: role=${role} uid=${doc.id} ip=${req.ip}`);
        return res.json({ success: true, customToken, role, orgId: DEMO_ORG_ID });
    } catch (error) {
        next(error);
    }
};
