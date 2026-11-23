/**
 * Demo mode: a 1-click sign-in to a dedicated DEMO organization (see controllers/demoController.js).
 * Off unless KYLRX_DEMO_MODE=true. In production it additionally needs KYLRX_DEMO_MODE_ALLOW_PRODUCTION=true.
 * Read per call, so the setting always reflects the environment.
 */
const DEMO_ORG_ID = 'org_demo';
const DEMO_ROLES = ['admin', 'hrms', 'manager', 'employee'];

function demoEnabled(env = process.env) {
    if (env.KYLRX_DEMO_MODE !== 'true') return false;
    if (env.NODE_ENV === 'production') return env.KYLRX_DEMO_MODE_ALLOW_PRODUCTION === 'true';
    return true;
}

/** Called once at startup: says out loud when demo sign-in is on, or when it was asked for and refused */
function logDemoModeStatus(logger, env = process.env) {
    if (demoEnabled(env)) {
        logger.warn(`[DEMO MODE] 1-click demo login is ON (organization ${DEMO_ORG_ID}${env.NODE_ENV === 'production' ? ', allowed in PRODUCTION by KYLRX_DEMO_MODE_ALLOW_PRODUCTION' : ''}). Anyone who can reach this server can sign in to the demo organization.`);
    } else if (env.KYLRX_DEMO_MODE === 'true') {
        logger.warn('[DEMO MODE] KYLRX_DEMO_MODE=true is ignored in production without KYLRX_DEMO_MODE_ALLOW_PRODUCTION=true.');
    }
}

module.exports = { DEMO_ORG_ID, DEMO_ROLES, demoEnabled, logDemoModeStatus };
