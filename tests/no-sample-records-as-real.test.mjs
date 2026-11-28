/**
 * Sample records must never be served as an organisation's own.
 *
 * Many modules started with sample data and used it whenever the organisation had
 * none: employee PF/ESIC/PT/LWF/NPS/gratuity profiles keyed EMP0001... (every
 * organisation's first employee is EMP0001), a bank account, salary structures, cost
 * centres and their owners, sub-departments with invented heads, holiday calendars,
 * statutory registrations, goals, and payroll-email employees. The finance and salary
 * ledgers also shared records across organisations through a "default:" key. Each of
 * these now starts empty; the samples load only through an explicit test hook.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');

/** Load a browser UMD module fresh, as the page does. */
function umd(file) {
  const m = { exports: {} };
  new Function('module', 'exports', 'require', read(file))(m, m.exports, () => ({}));
  return m.exports;
}

describe('nothing is preloaded as an organisation\'s data', () => {
  it('cost centres and sub-departments start empty', () => {
    assert.equal(umd('costCenterService.js').getAllCostCenters().length, 0);
    assert.equal(umd('subDepartmentService.js').getAllSubDepartments().length, 0);
  });

  it('a new organisation has no holiday calendars or statutory registrations', () => {
    const hol = umd('holidayCalendarService.js');
    const stat = umd('statutoryComplianceService.js');
    assert.equal(stat.getAllComplianceRules('org_new').length, 0);
    const src = read('holidayCalendarService.js');
    assert.ok(!/DEFAULT_SEED_CALENDARS\.forEach\(cal => \{\s*const calCopy/.test(src), 'calendars are seeded into each organisation again');
    assert.equal(typeof hol.loadSamplesForTesting, 'function');
  });

  it('statutory profile services seed nothing on load', () => {
    for (const f of ['pfDetailsService.js', 'esicDetailsService.js', 'ptDetailsService.js', 'lwfDetailsService.js', 'npsDetailsService.js', 'gratuityDetailsService.js']) {
      assert.ok(!/^\s+seedDefaultRecords\(\);\s*$/m.test(read(f)), f + ' seeds its samples on load again');
    }
  });

  it('goal engines and payroll email accounts start empty', () => {
    const EmpGoals = require('../services/employee-goals-engine.js').constructor;
    const MgrGoals = require('../services/manager-goals-engine.js').constructor;
    assert.equal(new EmpGoals().goals.size, 0);
    assert.equal(new MgrGoals().goals.size, 0);
    const Payroll = require('../services/payroll-email-account-service.js').constructor;
    assert.equal(new Payroll().sampleEmployees.size, 0);
  });

  it('a person with no saved goals is not shown someone else\'s', () => {
    for (const f of ['employee-goals-controller.js', 'manager-goals-controller.js']) {
      assert.ok(!/saveLocal\w*Goals\(SEED_\w*GOALS\)/.test(read(f)), f + ' falls back to sample goals');
    }
  });
});

describe('records stay inside their organisation', () => {
  it('finance and salary ledgers keep no shared "default:" copy and refuse without an organisation', () => {
    for (const f of ['services/employee-finance-service.js', 'services/salary-structure-service.js']) {
      const src = read(f);
      assert.ok(!/`default:/.test(src) && !/'default:'/.test(src), f + ' shares records across organisations again');
      assert.ok(!/'org_kylrx'/.test(src), f + ' falls back to another organisation');
    }
  });

  it('a finance lookup for one organisation never returns another\'s', async () => {
    const fin = umd('services/employee-finance-service.js');
    fin.loadSamplesForTesting('org_a');
    assert.equal(await fin.getEmployeeFinance('org_b', 'EMP0001'), null);
    await assert.rejects(async () => fin.getEmployeeFinance(null, 'EMP0001'), /No organization/);
  });
});

describe('nothing writes sample records into the database', () => {
  it('the attendance seeders are gone', () => {
    const src = read('attendance-service.js');
    for (const fn of ['seedSampleRegularizationsIfEmpty', 'seedDefaultShiftsIfEmpty', 'seedSampleAttendanceIfEmpty']) {
      assert.ok(!src.includes(fn), fn + ' would write sample records for a real organisation');
    }
  });

  it('the workflow builder offers no invented people', () => {
    assert.ok(!/Aarav Sharma|Rohan Gupta/.test(read('admin-workflow-builder.js')));
  });
});
