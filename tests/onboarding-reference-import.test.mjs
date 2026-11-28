/**
 * Departments, Designations, Locations and Employees from the import template - sheets
 * the template always had and nothing read.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parseReferenceRows, saveReferenceRecords, kindForSheet, toIsoDate } from '../onboarding-reference-import.js';

/** A Firestore stand-in: collections are path strings, writes are recorded. */
function fakeDb(seed = {}) {
  const store = new Map(Object.entries(seed).map(([p, docs]) => [p, new Map(Object.entries(docs))]));
  const writes = [];
  const deps = {
    db: {},
    doc: (_db, ...p) => ({ path: p.join('/') }),
    collection: (_db, ...p) => ({ path: p.join('/') }),
    serverTimestamp: () => 'ts',
    orgId: 'org_a',
    setDoc: async (ref, data) => {
      writes.push({ path: ref.path, data });
      const parts = ref.path.split('/'); const id = parts.pop(); const col = parts.join('/');
      if (!store.has(col)) store.set(col, new Map());
      store.get(col).set(id, data);
    },
    getDocs: async (ref) => {
      const m = store.get(ref.path) || new Map();
      return { forEach: (fn) => [...m.entries()].forEach(([id, d]) => fn({ id, data: () => d })) };
    }
  };
  return { deps, writes };
}

describe('sheets are recognised', () => {
  it('by the names the template and the old workbook use', () => {
    assert.equal(kindForSheet('Departments'), 'departments');
    assert.equal(kindForSheet('Designations'), 'designations');
    assert.equal(kindForSheet('Locations_Branches'), 'locations');
    assert.equal(kindForSheet('Employees_Master'), 'employees');
    assert.equal(kindForSheet('Business Unit'), null);
  });
  it('reads dates as people write them', () => {
    assert.equal(toIsoDate('2026-04-01'), '2026-04-01');
    assert.equal(toIsoDate('01/04/2026'), '2026-04-01');
    assert.equal(toIsoDate(46113), '2026-04-01');
    assert.equal(toIsoDate('soon'), '');
  });
});

describe('rows are checked before anything is saved', () => {
  it('rejects a missing code, a bad code and a duplicate', () => {
    const r = parseReferenceRows('designations', [
      { Designation_Code: 'SE', Designation_Name: 'Software Engineer' },
      { Designation_Code: '', Designation_Name: 'No code' },
      { Designation_Code: 'S E', Designation_Name: 'Space' },
      { Designation_Code: 'se', Designation_Name: 'Again' }
    ]);
    assert.equal(r.records.length, 1);
    assert.equal(r.errors.length, 3);
  });
  it('imports no super admin and no bad email', () => {
    const r = parseReferenceRows('employees', [
      { 'Official Email': 'a@x.in', 'Employee Name': 'A', Role: 'Super Admin' },
      { 'Official Email': 'not-an-email', 'Employee Name': 'B', Role: 'Employee' },
      { 'Official Email': 'c@x.in', 'Employee Name': 'C', Role: 'Manager' }
    ]);
    assert.equal(r.records.length, 1);
    assert.match(r.errors.join(' '), /Super admins are not imported/);
  });
});

describe('saving', () => {
  it('departments go where the app reads them, one per organisation', async () => {
    const { deps, writes } = fakeDb();
    const parsed = parseReferenceRows('departments', [{ Department_Code: 'OPS', Department_Name: 'Operations', Cost_Center_Code: 'CC-1' }]);
    const res = await saveReferenceRecords('departments', parsed.records, deps);
    assert.equal(res.saved, 1);
    assert.equal(writes[0].path, 'command_centers/org_a__OPS', 'a code shared with another organisation must not collide');
    assert.equal(writes[0].data.name, 'Operations');
  });

  it('designations and locations go under the organisation', async () => {
    const { deps, writes } = fakeDb();
    await saveReferenceRecords('designations', [{ code: 'SE', name: 'Software Engineer', departmentCode: '' }], deps);
    await saveReferenceRecords('locations', [{ code: 'BLR', name: 'Bengaluru', state: 'KA', country: 'India', isHeadquarters: true }], deps);
    assert.deepEqual(writes.map(w => w.path), ['organizations/org_a/designations/SE', 'organizations/org_a/locations/BLR']);
  });

  it('employees continue the ID sequence, resolve departments and managers, and skip people already there', async () => {
    const { deps, writes } = fakeDb({
      employees: { EMP0007: { employeeId: 'EMP0007', email: 'boss@x.in', name: 'Boss' } },
      command_centers: { org_a__OPS: { name: 'Operations', departmentCode: 'OPS' } },
      'organizations/org_a/designations': { SE: { designationCode: 'SE', designationName: 'Software Engineer' } }
    });
    const parsed = parseReferenceRows('employees', [
      { 'Official Email': 'new1@x.in', 'Employee Name': 'New One', Department: 'Operations', Designation: 'Software Engineer', 'Reporting Manager': 'boss@x.in', 'Joining Date': '2026-04-01', Role: 'Employee' },
      { 'Official Email': 'new2@x.in', 'Employee Name': 'New Two', Department: 'OPS', 'Reporting Manager': 'new1@x.in', Role: 'Manager' },
      { 'Official Email': 'boss@x.in', 'Employee Name': 'Boss Again', Role: 'Employee' },
      { 'Official Email': 'new3@x.in', 'Employee Name': 'Lost', Department: 'Nowhere', Role: 'Employee' },
      { 'Official Email': 'new4@x.in', 'Employee Name': 'Orphan', 'Reporting Manager': 'ghost@x.in', Role: 'Employee' }
    ]);
    const res = await saveReferenceRecords('employees', parsed.records, deps);
    assert.equal(res.saved, 2);
    const emp = writes.filter(w => w.path.startsWith('employees/')).map(w => w.data);
    assert.deepEqual(emp.map(e => e.employeeId), ['EMP0008', 'EMP0009'], 'IDs continue after the highest in use');
    assert.equal(emp[0].departmentId, 'org_a__OPS');
    assert.equal(emp[0].designationCode, 'SE');
    assert.equal(emp[0].reportingManagerId, 'EMP0007');
    assert.equal(emp[1].reportingManagerId, 'EMP0008', 'a manager in the same file is found');
    assert.ok(writes.some(w => w.path === 'users/EMP0008'));
    assert.ok(!('password' in emp[0]) && !('tempPassword' in emp[0]), 'no password is invented or stored');
    const errs = res.errors.join('\n');
    assert.match(errs, /boss@x\.in: already an employee/);
    assert.match(errs, /department "Nowhere" does not exist/);
    assert.match(errs, /reporting manager "ghost@x\.in" is not an employee/);
  });

  it('refuses without an organisation', async () => {
    const { deps } = fakeDb();
    await assert.rejects(saveReferenceRecords('locations', [], { ...deps, orgId: null }), /no organization/);
  });
});

describe('the employee form offers this organisation\'s own values', async () => {
  const { fillEmployeeFormOptions } = await import('../employee-form-options.js');
  function page() {
    const els = {};
    for (const id of ['designationSelect', 'locationCodeSelect', 'shiftCodeSelect']) els[id] = { innerHTML: '', required: true, dataset: { wasRequired: id === 'designationSelect' ? 'true' : undefined } };
    globalThis.document = { getElementById: (id) => els[id] || null };
    return els;
  }
  const deps = (data) => ({
    db: {}, orgId: 'org_a',
    collection: (_db, ...p) => ({ path: p.join('/') }),
    getDocs: async (ref) => ({ forEach: (fn) => (data[ref.path] || []).forEach((d, i) => fn({ id: 'id' + i, data: () => d })) })
  });

  it('an organisation with none sees that it has none, and the field is optional', async () => {
    const els = page();
    await fillEmployeeFormOptions({}, deps({}));
    assert.match(els.designationSelect.innerHTML, /No designations set up yet/);
    assert.equal(els.designationSelect.required, false);
    assert.ok(!/DES-SE|Software Engineer/.test(els.designationSelect.innerHTML), 'an invented designation is offered');
  });

  it('lists the organisation\'s records and keeps a saved value that is no longer listed', async () => {
    const els = page();
    await fillEmployeeFormOptions({}, deps({ 'organizations/org_a/designations': [{ designationCode: 'ACC', designationName: 'Accountant' }] }), { designation: 'OLD' });
    assert.match(els.designationSelect.innerHTML, /value="ACC">ACC - Accountant/);
    assert.match(els.designationSelect.innerHTML, /value="OLD" selected>OLD \(not in your list\)/);
    assert.equal(els.designationSelect.required, true);
  });

  it('the page ships no hard-coded designations, offices, shifts or cost centres', async () => {
    const fs = await import('node:fs');
    const html = fs.readFileSync(new URL('../admin-dashboard.html', import.meta.url), 'utf8');
    for (const v of ['DES-SE', 'LOC-BLR', 'SHIFT-GEN', 'CC-ENG-101']) assert.ok(!html.includes(v), v + ' is back in the form');
  });
});
