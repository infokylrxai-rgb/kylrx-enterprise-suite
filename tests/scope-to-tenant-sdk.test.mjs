/**
 * scopeToTenant() in firebase-config.js is what turns a whole-collection read into one
 * filtered by the caller's organisation. It works by reading internals of Firestore SDK
 * objects - target.type, target._query.path, target._query.filters - so reading the
 * source cannot show it works; it has to be run against real SDK objects.
 *
 * firebase-config.js itself imports from a CDN and cannot be loaded in Node, so the real
 * functions are extracted from it and run against references built by the installed
 * firebase package. Building a reference needs no network.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { initializeApp } from 'firebase/app';
import { getFirestore, collection, doc, query, where } from 'firebase/firestore';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const src = fs.readFileSync(path.join(ROOT, 'firebase-config.js'), 'utf8');

function extract(name) {
  const start = src.indexOf('function ' + name + '(');
  assert.ok(start > -1, name + ' not found in firebase-config.js');
  let depth = 0;
  for (let j = src.indexOf('{', start); j < src.length; j++) {
    if (src[j] === '{') depth++;
    else if (src[j] === '}' && --depth === 0) return src.slice(start, j + 1);
  }
  throw new Error('unterminated ' + name);
}

const globalsLine = src.match(/const GLOBAL_COLLECTIONS = (new Set\([^;]+\));/);
const scopingLine = src.match(/const TENANT_READ_SCOPING = (true|false);/);
assert.ok(globalsLine && scopingLine, 'could not read the scoping configuration');

function build(activeOrgId) {
  // eslint-disable-next-line no-new-func
  return new Function('query', 'where', 'activeOrgId',
    'const GLOBAL_COLLECTIONS = ' + globalsLine[1] + ';\n' +
    'const TENANT_READ_SCOPING = ' + scopingLine[1] + ';\n' +
    ['topLevelCollectionOf', 'isTenantScoped', 'hasOrgFilter', 'scopeToTenant'].map(extract).join('\n') +
    '\nreturn scopeToTenant;')(query, where, activeOrgId);
}

const db = getFirestore(initializeApp({ projectId: 'scope-test' }, 'scope-test-' + Date.now()));

/** The orgId equality filter on a built query, or null. Read from the same internals. */
function orgFilterOf(q) {
  const flat = (fs) => fs.flatMap(f => f.filters ? flat(f.filters) : [f]);
  const f = flat((q && q._query && q._query.filters) || [])
    .find(x => x.field && x.field.canonicalString() === 'orgId');
  return f ? { op: f.op, value: f.value && (f.value.stringValue ?? f.value) } : null;
}

describe('scopeToTenant against real Firestore SDK objects', () => {
  it('is switched on', () => {
    assert.equal(scopingLine[1], 'true', 'TENANT_READ_SCOPING is off: 110 browser reads go back to failing');
  });

  it('adds orgId == the active org to a whole-collection read', () => {
    const scoped = build('org_bosco')(collection(db, 'attendance'));
    assert.deepEqual(orgFilterOf(scoped), { op: '==', value: 'org_bosco' });
  });

  it('scopes every collection behind the broken dashboards', () => {
    const scope = build('org_bosco');
    for (const c of ['users', 'command_centers', 'attendance', 'department_teams', 'employees',
                     'payroll_profiles', 'departments', 'holidays', 'shifts', 'alertEvents']) {
      assert.deepEqual(orgFilterOf(scope(collection(db, c))), { op: '==', value: 'org_bosco' }, c + ' was not scoped');
    }
  });

  it('keeps the caller\'s own filters and adds the org beside them', () => {
    const q = query(collection(db, 'attendance'), where('status', '==', 'Present'));
    const scoped = build('org_bosco')(q);
    assert.deepEqual(orgFilterOf(scoped), { op: '==', value: 'org_bosco' });
    const fields = scoped._query.filters.flatMap(f => f.filters || [f]).map(f => f.field.canonicalString());
    assert.ok(fields.includes('status'), 'the original filter was dropped');
  });

  it('does not add a second org filter to a read already scoped', () => {
    const already = query(collection(db, 'attendance'), where('orgId', '==', 'org_bosco'));
    assert.equal(build('org_bosco')(already), already, 'should be returned untouched');
  });

  it('leaves the global collections alone', () => {
    const scope = build('org_bosco');
    for (const c of ['organizations', 'system_config']) {
      const ref = collection(db, c);
      assert.equal(scope(ref), ref, c + ' is global and must not be filtered');
    }
  });

  it('leaves single-document reads alone', () => {
    const ref = doc(db, 'attendance/abc');
    assert.equal(build('org_bosco')(ref), ref);
  });

  it('leaves subcollections alone - they inherit their parent\'s tenant', () => {
    const ref = collection(db, 'organizations/org_bosco/policies');
    assert.equal(build('org_bosco')(ref), ref);
  });

  it('does nothing without an active org, rather than inventing one', () => {
    const ref = collection(db, 'attendance');
    assert.equal(build(null)(ref), ref);
  });
});
