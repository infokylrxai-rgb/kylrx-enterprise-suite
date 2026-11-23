/**
 * Every query that needs a composite index has one in firestore.indexes.json (scripts/check-indexes.js
 * reads the code's queries), and the file itself is sound: valid JSON, no duplicates.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const indexes = JSON.parse(fs.readFileSync(fileURLToPath(new URL('../firestore.indexes.json', import.meta.url)), 'utf8')).indexes;

describe('firestore.indexes.json', () => {
  it('has an index for every query that needs one, as written and once orgId is added', () => {
    const { missing } = require('../scripts/check-indexes.js');
    assert.deepEqual(missing.map(m => `${m.col} (${m.fields.map(f => f.fieldPath).join(', ')}) <- ${m.where[0]}`), []);
  });

  it('has no duplicate indexes', () => {
    const keys = indexes.map(i => `${i.collectionGroup}|${i.queryScope}|${i.fields.map(f => `${f.fieldPath}:${f.order || f.arrayConfig}`).join(',')}`);
    assert.deepEqual(keys.filter((k, i) => keys.indexOf(k) !== i), []);
  });

  it('keeps the indexes added for the messaging, notification, user-list and attendance queries', () => {
    const has = (group, ...fields) => indexes.some(i => i.collectionGroup === group && JSON.stringify(i.fields.map(f => f.fieldPath)) === JSON.stringify(fields));
    assert.ok(has('users', 'orgId', 'createdAt'), 'GET /api/admin/employees');
    assert.ok(has('attendance', 'orgId', 'userId', 'date'), 'GET /api/data/attendance for an employee');
    assert.ok(has('attendance', 'orgId', 'date'), 'GET /api/data/attendance');
    assert.ok(has('notifications', 'toUserId', 'timestamp'));
    assert.ok(has('conversations', 'participants', 'lastMessageAt'));
  });
});
