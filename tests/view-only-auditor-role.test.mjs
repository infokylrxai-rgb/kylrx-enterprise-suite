/**
 * A view-only role, so an organisation can give somebody - an accountant, an internal
 * auditor, a nervous founder - sight of everything without the ability to change
 * anything.
 *
 * It could not be done by adding a name to ADMIN_HR_ROLES: authorize() gates a whole
 * route, so that would have handed the role every POST, PATCH and DELETE those routes
 * expose. Nor could it be added to isStaff(), canAccessStaff() or canAccessAdmin() in
 * firestore.rules, which between them guard 66 write rules. So it is enforced twice:
 * per request on the server, and on read rules only in the database.
 *
 * What must hold: an auditor reads, an auditor never writes, and nothing about the
 * other roles changes.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import fs from 'node:fs';

process.env.NODE_ENV = 'test';
const require = createRequire(import.meta.url);
const { authorize, isReadOnlyRole, ADMIN_HR_ROLES } = require('../middleware/authMiddleware.js');

/** Runs the guard and reports what happened: 'next', or the refusal status. */
function run(role, method, roles = ADMIN_HR_ROLES) {
  let outcome = null, body = null;
  const res = { status(c) { outcome = c; return this; }, json(b) { body = b; return this; } };
  authorize(roles)({ user: { role }, method }, res, () => { outcome = 'next'; });
  return { outcome, body };
}

describe('the auditor role on the server', () => {
  it('reads are allowed, on routes that never named the role', () => {
    for (const method of ['GET', 'HEAD', 'OPTIONS']) {
      assert.equal(run('auditor', method).outcome, 'next', `${method} must be allowed`);
    }
  });

  it('every writing method is refused', () => {
    for (const method of ['POST', 'PATCH', 'PUT', 'DELETE']) {
      const { outcome, body } = run('auditor', method);
      assert.equal(outcome, 403, `${method} must be refused`);
      assert.equal(body.code, 'read_only_role');
      assert.match(body.error, /view-only/i);
    }
  });

  it('is refused on writes even where the route explicitly lists it', () => {
    // A route naming 'auditor' must not thereby grant it writes.
    assert.equal(run('auditor', 'POST', ['auditor', 'Admin']).outcome, 403);
    assert.equal(run('auditor', 'GET', ['auditor', 'Admin']).outcome, 'next');
  });

  it('an odd spelling is still treated as view-only', () => {
    for (const spelling of ['Auditor', 'AUDITOR', ' auditor ']) {
      assert.equal(run(spelling, 'DELETE').outcome, 403, `${spelling} must not get a write through`);
    }
  });

  it('changes nothing for the existing roles', () => {
    assert.equal(run('super_admin', 'POST', ['super_admin']).outcome, 'next');
    assert.equal(run('hr_admin', 'POST', ADMIN_HR_ROLES).outcome, 'next');
    assert.equal(run('employee', 'GET', ADMIN_HR_ROLES).outcome, 403, 'an employee is still refused');
    assert.equal(run('employee', 'POST', ADMIN_HR_ROLES).outcome, 403);
  });

  it('recognises only the roles meant to be view-only', () => {
    assert.equal(isReadOnlyRole('auditor'), true);
    for (const r of ['super_admin', 'hr_admin', 'manager', 'employee', '', null, undefined]) {
      assert.equal(isReadOnlyRole(r), false, `${r} must not be view-only`);
    }
  });
});

describe('the auditor role in the Firestore rules', () => {
  const rules = fs.readFileSync(new URL('../firestore.rules', import.meta.url), 'utf8');

  it('has a read gate of its own', () => {
    assert.match(rules, /function isAuditor\(\)/);
    assert.match(rules, /function canView\(\)/);
  });

  /** The property that keeps this from being a privilege escalation. */
  it('never appears on a write rule', () => {
    const writesWithCanView = (rules.match(/allow (write|create|update|delete)[^;]*canView\(\)/g) || []);
    assert.equal(writesWithCanView.length, 0, 'canView() must guard no write rule');
    const writesWithAuditor = (rules.match(/allow (write|create|update|delete)[^;]*isAuditor\(\)/g) || []);
    assert.equal(writesWithAuditor.length, 0, 'isAuditor() must guard no write rule');
  });

  it('is kept out of the helpers that guard writes', () => {
    // isStaff / canAccessStaff / canAccessAdmin guard 66 write rules between them; an
    // auditor inside any of them would inherit all of it.
    const body = (name) => {
      const m = rules.match(new RegExp('function ' + name + '\\(\\)\\s*\\{([\\s\\S]*?)\\n\\s*\\}'));
      return m ? m[1] : '';
    };
    for (const fn of ['isStaff', 'canAccessStaff', 'canAccessAdmin', 'isHrRole', 'isSuperAdmin']) {
      assert.ok(!/auditor/i.test(body(fn)), `${fn}() must not include the auditor`);
    }
  });

  /**
   * These are match counts, not line counts - one line can carry more than one allow
   * clause. Verified against the committed rules file when this role was added: the 68
   * write rules guarded by these three helpers were byte-identical before and after,
   * and only read rules moved to canView().
   */
  it('still guards exactly the same write rules as before', () => {
    const count = (re) => (rules.match(re) || []).length;
    assert.equal(count(/allow (write|create|update|delete)[^;]*canAccessAdmin\(\)/g), 47);
    assert.equal(count(/allow (write|create|update|delete)[^;]*canAccessStaff\(\)/g), 6);
    assert.equal(count(/allow (write|create|update|delete)[^;]*isStaff\(\)/g), 16);
    assert.equal(count(/allow (write|create|update|delete)[^;]*(canAccessAdmin|canAccessStaff|isStaff)\(\)/g), 68);
  });

  it('left no read rule behind on a helper that also guards writes', () => {
    const stragglers = (rules.match(/allow read:[^;]*(canAccessAdmin|canAccessStaff)\(\)/g) || []);
    assert.equal(stragglers.length, 0, 'every staff/admin read rule should now use canView()');
    assert.equal((rules.match(/allow read:[^;]*canView()/g) || []).length, 15);
  });
});

describe('offering the role', () => {
  it('is assignable from the Roles & Access page', () => {
    const { ASSIGNABLE_ROLES } = require('../controllers/orgRolesController.js');
    const auditor = ASSIGNABLE_ROLES.find(r => r.value === 'auditor');
    assert.ok(auditor, 'auditor must be assignable');
    assert.match(auditor.label, /view only/i, 'the label must say what it means');
  });
});
