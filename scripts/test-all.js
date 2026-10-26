// Runs every test file in tests/ and services/ (or only the files given as arguments).
// Emulator-only files are left out here and run by `npm run test:emulator`.
// Firebase credentials are blanked so a test can never reach a real project.
const fs = require('fs');
const { spawnSync } = require('child_process');

const EMULATOR_ONLY = new Set([
    'tests/firestore-rules.test.mjs',
    'tests/tenant-leak.test.mjs',
    'tests/firestore-users-security.test.mjs'
]);

const args = process.argv.slice(2);
const files = args.length
    ? args
    : ['tests', 'services']
        .flatMap(dir => fs.readdirSync(dir).filter(f => /\.test\.m?js$/.test(f)).map(f => `${dir}/${f}`))
        .filter(f => !EMULATOR_ONLY.has(f));

const env = { ...process.env, FIREBASE_SERVICE_ACCOUNT: '', FIREBASE_SERVICE_ACCOUNT_PATH: '', GOOGLE_APPLICATION_CREDENTIALS: '' };
// No --test-force-exit: on Windows with Node 24 it crashes libuv at exit (UV_HANDLE_CLOSING) and fails
// files whose tests all passed. Every file exits on its own; the timeout is the guard against a hang.
const run = spawnSync(process.execPath, ['--test', ...files], { stdio: 'inherit', env, timeout: 10 * 60 * 1000 });
process.exit(run.status === null ? 1 : run.status);
