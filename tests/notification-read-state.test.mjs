/**
 * Per-user notification read state (notification-read-state.js): readBy, the legacy shared
 * `read` flag, unread counts, optimistic updates, batching and audience matching.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

// The file is a browser ES module; load it without a module loader by turning `export` into plain declarations
const source = fs.readFileSync(fileURLToPath(new URL('../notification-read-state.js', import.meta.url)), 'utf8');
const names = [...source.matchAll(/^export (?:const|function) (\w+)/gm)].map(m => m[1]);
const api = new Function(source.replace(/^export /gm, '') + `\nreturn { ${names.join(', ')} };`)();
const { isRead, isUnread, canMarkUnread, unreadCount, withReadState, chunk, isTargetedTo } = api;

describe('read state', () => {
  it('is read for a user only when the uid is in readBy', () => {
    const n = { id: 'n1', readBy: ['alice'] };
    assert.equal(isRead(n, 'alice'), true);
    assert.equal(isUnread(n, 'bob'), true);
    assert.equal(isUnread({ id: 'n2' }, 'alice'), true); // no readBy at all
    assert.equal(isUnread({ id: 'n3', readBy: [] }, 'alice'), true);
  });

  it('treats the legacy shared read === true as read for everyone', () => {
    const legacy = { id: 'old', read: true };
    assert.equal(isRead(legacy, 'alice'), true);
    assert.equal(isRead(legacy, 'bob'), true);
    assert.equal(isUnread({ id: 'old2', read: false }, 'alice'), true);
  });

  it('cannot mark a legacy-read notification unread, but can mark any other one', () => {
    assert.equal(canMarkUnread({ read: true }), false);
    assert.equal(canMarkUnread({ read: false, readBy: ['alice'] }), true);
    assert.equal(canMarkUnread({}), true);
  });

  it('one user reading does not change another user', () => {
    const marked = withReadState({ id: 'n1', readBy: ['bob'] }, 'alice', true);
    assert.deepEqual(marked.readBy, ['bob', 'alice']);
    assert.equal(isRead(marked, 'bob'), true);
    const unmarked = withReadState(marked, 'alice', false);
    assert.deepEqual(unmarked.readBy, ['bob']);
    assert.equal(isUnread(unmarked, 'alice'), true);
    assert.equal(isRead(unmarked, 'bob'), true);
  });

  it('marking twice adds the uid once, and does not mutate the original', () => {
    const original = { id: 'n1', readBy: ['alice'] };
    const again = withReadState(original, 'alice', true);
    assert.deepEqual(again.readBy, ['alice']);
    assert.deepEqual(original.readBy, ['alice']);
    assert.deepEqual(withReadState({ id: 'n2' }, 'alice', true).readBy, ['alice']);
    assert.deepEqual(withReadState({ id: 'n3' }, 'alice', false).readBy, []);
  });

  it('counts unread per user with the same rule', () => {
    const list = [
      { id: '1' },
      { id: '2', readBy: ['alice'] },
      { id: '3', read: true },
      { id: '4', readBy: ['bob'] }
    ];
    assert.equal(unreadCount(list, 'alice'), 2); // 1 and 4
    assert.equal(unreadCount(list, 'bob'), 2);   // 1 and 2; 3 is legacy-read and 4 is read by bob
  });
});

describe('batching', () => {
  it('splits into batches of at most 500', () => {
    const ids = Array.from({ length: 1203 }, (_, i) => `n${i}`);
    const parts = chunk(ids, 500);
    assert.deepEqual(parts.map(p => p.length), [500, 500, 203]);
    assert.deepEqual(parts.flat(), ids);
    assert.deepEqual(chunk([], 500), []);
    assert.deepEqual(chunk(['a'], 500), [['a']]);
  });
});

describe('audience', () => {
  const admin = { uid: 'a1', role: 'Super Admin' };
  const manager = { uid: 'm1', role: 'manager' };
  const employee = { uid: 'e1', role: 'Employee' };

  it('"all" reaches every role', () => {
    for (const u of [admin, manager, employee]) assert.equal(isTargetedTo({ target: 'all' }, u), true);
  });

  it('a role target reaches that role only', () => {
    assert.equal(isTargetedTo({ target: 'manager' }, manager), true);
    assert.equal(isTargetedTo({ target: 'manager' }, employee), false);
    assert.equal(isTargetedTo({ target: 'Employee' }, employee), true);
    assert.equal(isTargetedTo({ target: 'Employee' }, manager), false);
    assert.equal(isTargetedTo({ target: 'admin_hr' }, admin), true);
    assert.equal(isTargetedTo({ target: 'admin_hr' }, employee), false);
  });

  it('a person target reaches that person, by uid or by a recipient field', () => {
    assert.equal(isTargetedTo({ target: 'e1' }, employee), true);
    assert.equal(isTargetedTo({ target: 'e1' }, { uid: 'e2', role: 'employee' }), false);
    assert.equal(isTargetedTo({ target: 'x', recipient_id: 'e1' }, employee), true);
    assert.equal(isTargetedTo({ target: 'x', userId: 'e1' }, { uid: 'e2', role: 'employee' }), false);
  });

  it('the author sees their own broadcast, and a notice with no audience is for admin roles only', () => {
    assert.equal(isTargetedTo({ target: 'employee', createdByUid: 'a1' }, admin), true);
    assert.equal(isTargetedTo({ title: 'system' }, admin), true);
    assert.equal(isTargetedTo({ title: 'system' }, employee), false);
  });
});

describe('inbox audiences', () => {
  const { isHrmsNotification, isManagerNotification } = api;

  it('HRMS inbox: addressed to HRMS, or an employee help request', () => {
    assert.equal(isHrmsNotification({ target: 'HRMS' }), true);
    assert.equal(isHrmsNotification({ departmentId: 'hrms' }), true);
    assert.equal(isHrmsNotification({ type: 'employee_help' }), true);
    assert.equal(isHrmsNotification({ type: 'employee_help_approved' }), true);
    assert.equal(isHrmsNotification({ target: 'manager' }), false);
    assert.equal(isHrmsNotification(null), false);
  });

  it('manager inbox: managers, me, my center or department, general/untargeted, help requests', () => {
    const me = { uid: 'M1', centerId: 'cc_eng', dept: 'Engineering' };
    for (const n of [{ target: 'manager' }, { target: 'm1' }, { target: 'CC_ENG' }, { target: 'engineering' }, { target: 'general' }, {}, { type: 'employee_help', target: 'x' }]) {
      assert.equal(isManagerNotification(n, me), true, JSON.stringify(n));
    }
    for (const n of [{ target: 'employee' }, { target: 'm2' }, { target: 'cc_sales' }, { target: 'hrms' }]) {
      assert.equal(isManagerNotification(n, me), false, JSON.stringify(n));
    }
    // an empty context matches nobody's personal target
    assert.equal(isManagerNotification({ target: 'm1' }, {}), false);
  });
});
