/**
 * Confirmed Firestore writes for API routes.
 *
 * While the project's Firestore write quota is exhausted the Admin SDK keeps retrying a write
 * instead of failing, so a save would hang. confirmedWrite():
 *   - fails immediately (503) for FAST_FAIL_MS after Firestore refused a write;
 *   - if a write is still pending after PROBE_AFTER_MS, asks Firestore directly (REST) whether
 *     it accepts writes - the REST API answers 429 at once when the quota is used up - and
 *     fails right away in that case;
 *   - otherwise gives up after WRITE_TIMEOUT_MS.
 */
const WRITE_TIMEOUT_MS = 20000;
const PROBE_AFTER_MS = 2000;
const FAST_FAIL_MS = 2 * 60 * 1000;
const RECHECK_AFTER_MS = 2 * 60 * 1000;

let unavailableUntil = 0;
let lastConfirmedAt = 0;

function unavailableError() {
    const err = new Error('Firebase is not accepting saves right now (the daily Firestore write quota is used up). Nothing was saved. Please try again after the quota resets.');
    err.status = 503;
    return err;
}

function isQuotaError(err) {
    const text = `${err && err.code} ${err && err.message}`;
    return (err && err.code === 8) || /RESOURCE_EXHAUSTED|Quota exceeded/i.test(text);
}

/**
 * True when Firestore refuses writes with a quota error. Sends an update that requires a
 * document which never exists: with quota available Firestore rejects it as not found and
 * writes nothing; with the quota used up it answers 429. Any other outcome counts as
 * "writes are accepted".
 */
async function writesRefusedByQuota() {
    // Local test database (Firestore emulator): no quota applies
    if (process.env.FIRESTORE_EMULATOR_HOST) return false;
    try {
        const { admin } = require('./firebase');
        if (!admin.apps.length) return false;
        const app = admin.app();
        const projectId = app.options.projectId || (app.options.credential && app.options.credential.projectId) || 'kylrxai';
        const { access_token: token } = await app.options.credential.getAccessToken();
        const database = `projects/${projectId}/databases/(default)`;
        const res = await fetch(`https://firestore.googleapis.com/v1/${database}/documents:commit`, {
            method: 'POST',
            headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({
                writes: [{ update: { name: `${database}/documents/_write_probe/never_exists`, fields: {} }, currentDocument: { exists: true } }]
            }),
            signal: AbortSignal.timeout(5000)
        });
        return res.status === 429;
    } catch (_) {
        return false;
    }
}

/**
 * Resolves with the write's result once Firestore confirmed it; rejects with status 503 when
 * Firestore is refusing writes. Pass a function returning the write so nothing is sent while
 * writes are known to be failing.
 */
async function confirmedWrite(write) {
    if (Date.now() < unavailableUntil) throw unavailableError();
    // Without a recent confirmed write, check first: a write handed to the SDK keeps retrying in
    // the background and could land later, after the user was told it failed
    if (Date.now() - lastConfirmedAt > RECHECK_AFTER_MS && await writesRefusedByQuota()) {
        unavailableUntil = Date.now() + FAST_FAIL_MS;
        throw unavailableError();
    }
    const timers = [];
    try {
        const result = await Promise.race([
            typeof write === 'function' ? write() : write,
            new Promise((_, reject) => {
                timers.push(setTimeout(() => reject(unavailableError()), WRITE_TIMEOUT_MS));
                timers.push(setTimeout(async () => {
                    if (await writesRefusedByQuota()) reject(unavailableError());
                }, PROBE_AFTER_MS));
            })
        ]);
        lastConfirmedAt = Date.now();
        return result;
    } catch (err) {
        if (err.status === 503 || isQuotaError(err)) {
            unavailableUntil = Date.now() + FAST_FAIL_MS;
            throw err.status === 503 ? err : unavailableError();
        }
        throw err;
    } finally {
        timers.forEach(clearTimeout);
    }
}

/** Whether Firestore currently accepts writes (cached briefly; used by the browser before direct writes). */
let statusCache = { at: 0, accepting: true };
async function writeStatus() {
    if (process.env.FIRESTORE_EMULATOR_HOST) return { accepting: true, localTestDatabase: true };
    if (Date.now() < unavailableUntil) return { accepting: false };
    if (Date.now() - statusCache.at > 30000) {
        const refused = await writesRefusedByQuota();
        if (refused) unavailableUntil = Date.now() + FAST_FAIL_MS;
        statusCache = { at: Date.now(), accepting: !refused };
    }
    return { accepting: statusCache.accepting };
}

/** Lets the next write try Firestore again (e.g. after a Blaze upgrade). */
function resetWriteAvailability() {
    unavailableUntil = 0;
}

module.exports = { confirmedWrite, writeStatus, resetWriteAvailability, WRITE_TIMEOUT_MS };
