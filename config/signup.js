/**
 * Self-service organization signup.
 *
 * OFF unless KYLRX_ALLOW_PUBLIC_SIGNUP=true. Kylrx is sold to organizations and their access is
 * provisioned, so an open registration form is not a feature here - it is a way for strangers to
 * create tenants on infrastructure you pay for.
 *
 * It also lets someone take a name you need. register-organization derives the tenant key from the
 * company name (orgId = 'org_' + slug) and refuses a duplicate with 409, so whoever registers
 * "Acme" first owns org_acme - and the real Acme, when you come to onboard them, is told their own
 * organization is already registered.
 *
 * Read per call, so the setting always reflects the current environment.
 */
function publicSignupEnabled(env = process.env) {
    return env.KYLRX_ALLOW_PUBLIC_SIGNUP === 'true';
}

/** Express guard: behaves as if the route does not exist, rather than advertising a closed door. */
function requirePublicSignup(req, res, next) {
    if (publicSignupEnabled()) return next();
    return res.sendStatus(404);
}

/** Called once at startup so the setting is visible in the logs rather than assumed. */
function logSignupModeStatus(logger, env = process.env) {
    if (publicSignupEnabled(env)) {
        logger.warn('[SIGNUP] Public organization signup is ON: anyone who can reach this server can create a tenant.');
    } else {
        logger.info('[SIGNUP] Public organization signup is off; organizations are provisioned.');
    }
}

module.exports = { publicSignupEnabled, requirePublicSignup, logSignupModeStatus };
