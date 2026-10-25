/**
 * Runs Kylrx against a LOCAL TEST DATABASE (Firestore emulator) instead of live Firestore.
 *
 *   npm run start:local            first run copies live data into the local database
 *   npm run start:local -- --fresh discard local changes and copy live data again
 *
 * Saves go only to the local database (kept in .local-firestore/ between runs); the live
 * Firebase project is never written to. Login (Firebase Auth) still uses the real accounts.
 * Stop with Ctrl+C; local changes are saved on exit.
 */
const { spawn, spawnSync } = require('child_process');
const fs = require('fs');
const net = require('net');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const LOCAL_DIR = path.join(ROOT, '.local-firestore');
const DATA_DIR = path.join(LOCAL_DIR, 'emulator-data');
const SNAPSHOT = path.join(LOCAL_DIR, 'snapshot.json');
const EMULATOR_HOST = '127.0.0.1:8080';
const fresh = process.argv.includes('--fresh');

function portOpen(port) {
    return new Promise(resolve => {
        const socket = net.connect(port, '127.0.0.1', () => { socket.end(); resolve(true); });
        socket.on('error', () => resolve(false));
    });
}

async function waitForPort(port, timeoutMs) {
    const end = Date.now() + timeoutMs;
    while (Date.now() < end) {
        if (await portOpen(port)) return;
        await new Promise(r => setTimeout(r, 500));
    }
    throw new Error(`Firestore emulator did not start on port ${port}`);
}

function runNode(args, env) {
    const result = spawnSync(process.execPath, args, { cwd: ROOT, stdio: 'inherit', env });
    if (result.status !== 0) throw new Error(`${args.join(' ')} failed`);
}

(async () => {
    if (await portOpen(8080)) throw new Error('Port 8080 is already in use (is another emulator running?)');
    if (fresh) fs.rmSync(DATA_DIR, { recursive: true, force: true });
    const firstRun = !fs.existsSync(DATA_DIR);

    if (firstRun) {
        console.log('[local] Copying live Firestore data (read-only)...');
        const env = { ...process.env };
        delete env.FIRESTORE_EMULATOR_HOST;
        runNode(['scripts/local-db-snapshot.js', 'export'], env);
    }

    console.log('[local] Starting local test database (Firestore emulator) on ' + EMULATOR_HOST + '...');
    const emulatorArgs = ['emulators:start', '--only', 'firestore', '--project', 'kylrxai', '--export-on-exit', DATA_DIR];
    if (!firstRun) emulatorArgs.push('--import', DATA_DIR);
    const emulator = spawn('firebase', emulatorArgs, { cwd: ROOT, stdio: ['ignore', 'ignore', 'inherit'], shell: true });
    emulator.on('exit', code => { console.log(`[local] Emulator stopped (${code}).`); process.exit(code || 0); });
    await waitForPort(8080, 60000);

    const env = { ...process.env, FIRESTORE_EMULATOR_HOST: EMULATOR_HOST, KYLRX_LOCAL_DB: '1' };
    if (firstRun && fs.existsSync(SNAPSHOT)) runNode(['scripts/local-db-snapshot.js', 'import'], env);

    console.log('[local] Starting server. All saves go to the LOCAL TEST DATABASE.');
    const server = spawn(process.execPath, ['server.js'], { cwd: ROOT, stdio: 'inherit', env });
    const stop = () => { server.kill(); emulator.kill('SIGINT'); };
    process.on('SIGINT', stop);
    process.on('SIGTERM', stop);
    server.on('exit', code => { if (code) console.log(`[local] Server exited (${code}).`); });
})().catch(err => { console.error('[local]', err.message); process.exit(1); });
