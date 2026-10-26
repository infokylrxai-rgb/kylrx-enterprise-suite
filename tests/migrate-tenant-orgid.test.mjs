/**
 * scripts/migrate-tenant-orgid.js: a dry run by default, an explicit organization, a guard against
 * production-looking projects, and a per-collection summary. Uses a fake database; nothing real is touched.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { generateKeyPairSync } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const script = fileURLToPath(new URL('../scripts/migrate-tenant-orgid.js', import.meta.url));
const { parseArgs, looksLikeProduction, runMigration } = require(script);

// Fake Firestore + Auth that record every write
function fakeBackend() {
  const writes = { updates: [], commits: 0, claims: [], profileUpdates: [] };
  const collections = {
    employees: [{ id: 'e1' }, { id: 'e2', orgId: 'org_other' }, { id: 'e3' }],
    notifications: [{ id: 'n1' }],
    organizations: [{ id: 'org_x' }], // global: skipped
    messages: [{ id: 'm1', orgId: 'org_a' }]
  };
  const docOf = (name, d) => ({ id: d.id, ref: { path: `${name}/${d.id}` }, get: (f) => d[f] });
  const db = {
    listCollections: async () => Object.keys(collections).map(name => ({
      id: name,
      get: async () => ({ size: collections[name].length, docs: collections[name].map(d => docOf(name, d)) })
    })),
    batch: () => {
      const ops = [];
      return { update: (ref, data) => ops.push([ref.path, data]), commit: async () => { writes.commits++; writes.updates.push(...ops); } };
    },
    collection: () => ({
      doc: (uid) => ({
        get: async () => ({ exists: uid === 'u2', get: (f) => ({ orgId: 'org_profile', role: 'Employee' }[f]) }),
        update: async (data) => writes.profileUpdates.push([uid, data])
      })
    })
  };
  const admin = {
    auth: () => ({
      listUsers: async () => ({ users: [
        { uid: 'u1', email: 'a@x.test', customClaims: {} },
        { uid: 'u2', email: 'b@x.test', customClaims: { role: 'Admin' } },
        { uid: 'u3', email: 'c@x.test', customClaims: { orgId: 'org_done' } }
      ] }),
      setCustomUserClaims: async (uid, claims) => writes.claims.push([uid, claims])
    })
  };
  return { db, admin, writes, GLOBAL_COLLECTIONS: new Set(['organizations']) };
}

const run = (options) => {
  const { db, admin, writes, GLOBAL_COLLECTIONS } = fakeBackend();
  const lines = [];
  return runMigration({ db, admin, GLOBAL_COLLECTIONS, options, log: (l) => lines.push(l) }).then(result => ({ result, writes, out: lines.join('\n') }));
};

describe('arguments', () => {
  it('needs an explicit organization: there is no default', () => {
    assert.throws(() => parseArgs([]), /--org-id <id> is required/);
    assert.throws(() => parseArgs(['--write']), /--org-id <id> is required/);
    assert.throws(() => parseArgs(['--org-id']), /--org-id <id> is required/);
    assert.throws(() => parseArgs(['--org-id', '--write']), /--org-id <id> is required/);
    assert.throws(() => parseArgs(['--org-id', 'Acme Corp']), /must look like org_acme/);
  });

  it('is a dry run unless --write is given', () => {
    assert.equal(parseArgs(['--org-id', 'org_acme']).write, false);
    assert.equal(parseArgs(['--org-id=org_acme']).write, false);
    assert.equal(parseArgs(['--org-id', 'org_acme', '--dry-run']).write, false);
    assert.equal(parseArgs(['--org-id', 'org_acme', '--write']).write, true);
    assert.equal(parseArgs(['--write', '--org-id', 'org_acme']).orgId, 'org_acme');
  });

  it('the old flags and unknown flags are refused instead of silently ignored', () => {
    assert.throws(() => parseArgs(['--org-id', 'org_acme', '--apply']), /use --write/);
    assert.throws(() => parseArgs(['--org=org_x']), /use --org-id/);
    assert.throws(() => parseArgs(['--org-id', 'org_acme', '--force']), /Unknown option/);
  });
});

describe('production guard', () => {
  it('only an emulator or a demo / dev / test / staging project passes without --yes-really', () => {
    for (const id of ['demo-leak', 'acme-hr-dev', 'acme-hr-test', 'acme-hr-staging', 'acme-hr-stg']) assert.equal(looksLikeProduction({}, id), false, id);
    for (const id of ['acme-hr', 'acme-hr-prod', 'kylrx', 'devops-hr', undefined, '']) assert.equal(looksLikeProduction({}, id), true, String(id));
    assert.equal(looksLikeProduction({ FIRESTORE_EMULATOR_HOST: '127.0.0.1:8080' }, 'acme-hr'), false);
  });

  it('the command refuses a production-looking project with exit code 3, before listing any data', () => {
    // a real (generated) key so the SDK initializes; it makes no network call until it is used
    const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048, privateKeyEncoding: { type: 'pkcs8', format: 'pem' }, publicKeyEncoding: { type: 'spki', format: 'pem' } });
    const account = JSON.stringify({ type: 'service_account', project_id: 'acme-hr-prod', private_key: privateKey, client_email: 'x@acme-hr-prod.iam.gserviceaccount.com', client_id: '1' });
    const env = { PATH: process.env.PATH, SystemRoot: process.env.SystemRoot, FIREBASE_PROJECT_ID: 'acme-hr-prod', FIREBASE_SERVICE_ACCOUNT: account };
    for (const args of [['--org-id', 'org_acme'], ['--org-id', 'org_acme', '--write']]) {
      const refused = spawnSync(process.execPath, [script, ...args], { encoding: 'utf8', env });
      assert.equal(refused.status, 3, refused.stderr);
      assert.match(refused.stderr, /Refusing to run: project "acme-hr-prod" does not look like a test project/);
      assert.ok(!/Documents without an orgId/.test(refused.stdout));
    }
  });

  it('with no organization the command exits 2 without reading the environment', () => {
    const run = spawnSync(process.execPath, [script], { encoding: 'utf8', env: { PATH: process.env.PATH, SystemRoot: process.env.SystemRoot } });
    assert.equal(run.status, 2);
    assert.match(run.stderr, /--org-id <id> is required/);
  });
});

describe('the run itself', () => {
  it('a dry run writes nothing and prints the per-collection summary', async () => {
    const { result, writes, out } = await run({ orgId: 'org_acme', write: false });
    assert.deepEqual(writes, { updates: [], commits: 0, claims: [], profileUpdates: [] });
    assert.match(out, /DRY RUN/);
    assert.match(out, /employees\s+2\s+3/);
    assert.match(out, /notifications\s+1\s+1/);
    assert.match(out, /messages\s+0\s+1/);
    assert.ok(!/organizations\s+\d/.test(out), 'a global collection was listed');
    assert.match(out, /Would update: 3 documents in 2 collections, 2 user claims, 1 profile roles\./);
    assert.match(out, /Re-run with --write/);
    assert.equal(result.documents, 3);
  });

  it('--write tags only untagged documents with the given organization', async () => {
    const { writes, out } = await run({ orgId: 'org_acme', write: true });
    assert.deepEqual(writes.updates.map(u => u[0]).sort(), ['employees/e1', 'employees/e3', 'notifications/n1']);
    assert.ok(writes.updates.every(u => u[1].orgId === 'org_acme' && Object.keys(u[1]).length === 1));
    assert.deepEqual(writes.claims, [['u1', { orgId: 'org_acme' }], ['u2', { role: 'Admin', orgId: 'org_profile' }]]);
    assert.deepEqual(writes.profileUpdates, [['u2', { role: 'Admin' }]]);
    assert.match(out, /WRITING/);
    assert.match(out, /Updated: 3 documents/);
  });
});
