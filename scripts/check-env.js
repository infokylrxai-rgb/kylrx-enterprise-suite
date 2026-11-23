/**
 * Checks that the environment has every variable the chosen mode needs. Never prints a value.
 *
 *   npm run check:env                     mode from NODE_ENV (development if unset)
 *   npm run check:env -- --mode=production
 *
 * Reads .env from the current folder (real environment variables win, as in the server).
 * Exits 1 when a required variable is missing or still a placeholder. server.js runs the same
 * check at startup in production.
 */
const path = require('path');

const PLACEHOLDER = /CHANGE_ME|YOUR_[A-Z_]+/;

// Each entry is a list of alternatives: at least one of them must be set
const REQUIRED = {
    development: [
        ['JWT_SECRET'],
        ['REFRESH_SECRET']
    ],
    production: [
        ['JWT_SECRET'],
        ['REFRESH_SECRET'],
        ['FIREBASE_PROJECT_ID'],
        ['FIREBASE_STORAGE_BUCKET'],
        ['FIREBASE_SERVICE_ACCOUNT', 'FIREBASE_SERVICE_ACCOUNT_PATH'],
        ['KYLRX_EXPORT_SIGNING_KEY'],
        ['CASHFREE_CLIENT_ID'],
        ['CASHFREE_CLIENT_SECRET'],
        ['APP_URL']
    ]
};

// Not required to start, but a feature does not work (or uses a default) without them
const RECOMMENDED = {
    development: [],
    production: [
        ['ALLOWED_ORIGINS'],
        ['EMAIL_FROM', 'SMTP_USER'],
        ['SMTP_PASS', 'RESEND_API_KEY']
    ]
};

const isSet = (env, name) => typeof env[name] === 'string' && env[name].trim() !== '' && !PLACEHOLDER.test(env[name]);

/** { missing: [...], recommended: [...], problems: [...] } with variable NAMES only */
function checkEnv(mode, env = process.env) {
    if (!REQUIRED[mode]) throw new Error(`Unknown mode "${mode}" (use development or production)`);
    const label = (alts) => alts.join(' or ');
    const missing = REQUIRED[mode].filter(alts => !alts.some(n => isSet(env, n))).map(label);
    const recommended = RECOMMENDED[mode].filter(alts => !alts.some(n => isSet(env, n))).map(label);
    const problems = [];
    if (mode === 'production') {
        if (env.NODE_ENV !== 'production') problems.push('NODE_ENV is not "production"');
        if (env.ALLOW_DEV_IDENTITY === 'true') problems.push('ALLOW_DEV_IDENTITY=true has no effect in production; remove it');
        for (const name of ['JWT_SECRET', 'REFRESH_SECRET', 'KYLRX_EXPORT_SIGNING_KEY']) {
            if (isSet(env, name) && env[name].length < 32) problems.push(`${name} is shorter than 32 characters`);
        }
        if (isSet(env, 'JWT_SECRET') && env.JWT_SECRET === env.REFRESH_SECRET) problems.push('JWT_SECRET and REFRESH_SECRET must differ');
    }
    return { missing, recommended, problems };
}

/** Throws one error listing what is missing (names only) */
function assertEnv(mode, env = process.env) {
    const { missing, problems } = checkEnv(mode, env);
    if (missing.length || problems.length) {
        const lines = [
            ...missing.map(n => `missing: ${n}`),
            ...problems.map(p => `problem: ${p}`)
        ];
        throw new Error(`Environment is not ready for ${mode}:\n  ${lines.join('\n  ')}\nSee .env.example and README.md.`);
    }
}

module.exports = { checkEnv, assertEnv, REQUIRED, RECOMMENDED };

if (require.main === module) {
    require('dotenv').config({ path: path.join(process.cwd(), '.env'), quiet: true });
    const arg = process.argv.find(a => a.startsWith('--mode='));
    const mode = arg ? arg.split('=')[1] : (process.env.NODE_ENV === 'production' ? 'production' : 'development');
    let result;
    try {
        result = checkEnv(mode);
    } catch (err) {
        console.error(err.message);
        process.exit(2);
    }
    const { missing, recommended, problems } = result;
    console.log(`Environment check (${mode})`);
    if (!missing.length && !problems.length) console.log('  all required variables are set');
    missing.forEach(n => console.log(`  MISSING      ${n}`));
    problems.forEach(p => console.log(`  PROBLEM      ${p}`));
    recommended.forEach(n => console.log(`  recommended  ${n}`));
    process.exit(missing.length || problems.length ? 1 : 0);
}
