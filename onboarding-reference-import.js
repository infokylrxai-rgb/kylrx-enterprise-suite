/**
 * Departments, Designations, Locations and Employees from the import template.
 *
 * The template always had these sheets, but nothing read them: rows typed into them
 * were silently dropped, and the employee form offered seven invented designations
 * because there was nowhere real to take them from.
 *
 * Where each kind is stored - the same places the rest of the app reads:
 *   departments   command_centers/{orgId}__{code}   (what the app calls a department)
 *   designations  organizations/{orgId}/designations/{code}
 *   locations     organizations/{orgId}/locations/{code}
 *   employees     employees/{EMPnnnn} and users/{EMPnnnn}, as Add Employee writes them.
 *                 No login is created: the browser cannot make one for somebody else.
 *                 "Issue Logins & Invites" does that on the server.
 *
 * Parsing never writes. Saving reports what was saved and what was not, row by row.
 */

const norm = (v) => String(v == null ? '' : v).trim();
const key = (v) => norm(v).toLowerCase().replace(/[^a-z0-9]/g, '');

/** A cell by any of its accepted header names. */
function cell(row, names) {
  const want = names.map(key);
  for (const [k, v] of Object.entries(row)) if (want.includes(key(k))) return norm(v);
  return '';
}

const yes = (v) => /^(y|yes|true|1)$/i.test(norm(v));

/** Excel serial or text to YYYY-MM-DD; '' when it is not a date. */
export function toIsoDate(v) {
  if (v === '' || v == null) return '';
  if (typeof v === 'number' && isFinite(v)) {
    const d = new Date(Math.round((v - 25569) * 86400000));
    return isNaN(d) ? '' : d.toISOString().slice(0, 10);
  }
  const s = norm(v);
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const m = s.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/);           // DD/MM/YYYY
  if (m) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  return '';
}

const ROLE_MAP = {
  employee: 'employee', staff: 'employee',
  manager: 'manager', teamlead: 'manager',
  hr: 'hradmin', hradmin: 'hradmin', hrmanager: 'hradmin'
};

export const REFERENCE_KINDS = {
  departments: {
    title: 'Departments',
    sheets: ['departments', 'department'],
    columns: ['Department_Code', 'Department_Name', 'Cost_Center_Code']
  },
  designations: {
    title: 'Designations',
    sheets: ['designations', 'designation'],
    columns: ['Designation_Code', 'Designation_Name', 'Department_Code']
  },
  locations: {
    title: 'Locations',
    sheets: ['locations', 'locationsbranches', 'location', 'branches'],
    columns: ['Location_Code', 'Location_Name', 'State', 'Country', 'Is_Headquarters']
  },
  employees: {
    title: 'Employees',
    sheets: ['employees', 'employeesmaster', 'employee'],
    columns: ['Official Email', 'Employee Name', 'Department', 'Designation', 'Reporting Manager', 'Joining Date', 'Role', 'Business Unit', 'Sub-Department']
  }
};

/** Which kind, if any, a sheet name belongs to. */
export function kindForSheet(sheetName) {
  const k = key(sheetName);
  return Object.keys(REFERENCE_KINDS).find(kind => REFERENCE_KINDS[kind].sheets.includes(k)) || null;
}

/**
 * Validate rows. Returns { records, errors } where errors are "Row n: ..." strings and
 * records are the rows that can be saved. Nothing is looked up or written here except
 * duplicates within the sheet; cross-references are checked when saving.
 */
export function parseReferenceRows(kind, rows) {
  const records = [];
  const errors = [];
  const seen = new Set();
  rows.forEach((row, i) => {
    const n = i + 2;                                   // header is row 1
    if (Object.values(row).every(v => norm(v) === '')) return;
    const fail = (msg) => errors.push(`Row ${n}: ${msg}`);

    if (kind === 'departments' || kind === 'designations' || kind === 'locations') {
      const code = cell(row, [REFERENCE_KINDS[kind].columns[0]]).toUpperCase();
      const name = cell(row, [REFERENCE_KINDS[kind].columns[1]]);
      if (!code) return fail(`${REFERENCE_KINDS[kind].columns[0]} is missing.`);
      if (!/^[A-Z0-9_-]{2,40}$/.test(code)) return fail(`code "${code}" may use only letters, numbers, - and _.`);
      if (!name) return fail(`${REFERENCE_KINDS[kind].columns[1]} is missing.`);
      if (seen.has(code)) return fail(`code ${code} appears twice in this sheet.`);
      seen.add(code);
      if (kind === 'departments') records.push({ code, name, costCenterCode: cell(row, ['Cost_Center_Code']).toUpperCase() });
      if (kind === 'designations') records.push({ code, name, departmentCode: cell(row, ['Department_Code']).toUpperCase() });
      if (kind === 'locations') records.push({ code, name, state: cell(row, ['State']), country: cell(row, ['Country']) || 'India', isHeadquarters: yes(cell(row, ['Is_Headquarters'])) });
      return;
    }

    // employees
    const email = cell(row, ['Official Email', 'Email', 'Official_Email']).toLowerCase();
    const name = cell(row, ['Employee Name', 'Name', 'Full Name', 'Employee_Name']);
    const roleRaw = cell(row, ['Role']) || 'Employee';
    const role = ROLE_MAP[key(roleRaw)];
    const joining = toIsoDate(row['Joining Date'] ?? row['Joining_Date'] ?? cell(row, ['Joining Date', 'Date of Joining']));
    if (!name) return fail('Employee Name is missing.');
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return fail(`"${email || '(blank)'}" is not an email address.`);
    if (seen.has(email)) return fail(`${email} appears twice in this sheet.`);
    if (!role) return fail(`Role "${roleRaw}" is not one this import creates (Employee, Manager or HR). Super admins are not imported.`);
    const rawJoin = cell(row, ['Joining Date', 'Date of Joining']);
    if (rawJoin && !joining) return fail(`Joining Date "${rawJoin}" is not a date (use YYYY-MM-DD).`);
    seen.add(email);
    records.push({
      email, name, role,
      department: cell(row, ['Department']),
      designation: cell(row, ['Designation']),
      reportingManager: cell(row, ['Reporting Manager', 'Reporting_Manager', 'Manager']),
      joiningDate: joining,
      businessUnit: cell(row, ['Business Unit', 'Business_Unit_Code']).toUpperCase(),
      subDepartment: cell(row, ['Sub-Department', 'Sub_Department', 'Sub-Department_Code']).toUpperCase()
    });
  });
  return { records, errors };
}

/**
 * Save parsed records. deps: { db, doc, setDoc, getDocs, collection, serverTimestamp,
 * orgId, allocateIds?(count) }. Returns { saved, errors, ids }.
 */
export async function saveReferenceRecords(kind, records, deps) {
  const { db, doc, setDoc, getDocs, collection, serverTimestamp, orgId } = deps;
  if (!orgId) throw new Error('Your account has no organization.');
  const errors = [];
  let saved = 0;
  const now = serverTimestamp ? serverTimestamp() : new Date().toISOString();

  if (kind === 'departments') {
    for (const r of records) {
      try {
        await setDoc(doc(db, 'command_centers', `${orgId}__${r.code}`), {
          name: r.name, departmentName: r.name, departmentCode: r.code, unitId: r.code,
          costCenterCode: r.costCenterCode, targetType: 'Employee Suite', status: 'Live',
          subDepartments: [], apps: [], config: {}, icon: 'building-2',
          activeUsers: 0, aiInsights: 0, source: 'bulk_import', lastModified: now
        }, { merge: true });
        saved++;
      } catch (e) { errors.push(`${r.code}: ${e.message}`); }
    }
    return { saved, errors };
  }

  if (kind === 'designations' || kind === 'locations') {
    for (const r of records) {
      const data = kind === 'designations'
        ? { designationCode: r.code, designationName: r.name, departmentCode: r.departmentCode, isActive: true, updatedAt: now }
        : { locationCode: r.code, locationName: r.name, state: r.state, country: r.country, isHeadquarters: r.isHeadquarters, isActive: true, updatedAt: now };
      try { await setDoc(doc(db, 'organizations', orgId, kind, r.code), data, { merge: true }); saved++; }
      catch (e) { errors.push(`${r.code}: ${e.message}`); }
    }
    return { saved, errors };
  }

  // ── employees ────────────────────────────────────────────────────────────────
  const existing = [];
  (await getDocs(collection(db, 'employees'))).forEach(d => existing.push({ id: d.id, ...d.data() }));
  const departments = [];
  (await getDocs(collection(db, 'command_centers'))).forEach(d => departments.push({ id: d.id, ...d.data() }));
  const designations = [];
  try {
    (await getDocs(collection(db, 'organizations', orgId, 'designations'))).forEach(d => designations.push(d.data()));
  } catch (err) {
    // Designations are matched when they can be; without them the text is kept as given.
    console.warn('[Import] designations could not be read; keeping designations as written:', err);
  }

  const byEmail = new Map(existing.filter(e => e.email).map(e => [String(e.email).toLowerCase(), e.employeeId || e.id]));
  const findDept = (v) => {
    const k = key(v);
    return k ? departments.find(d => [d.departmentCode, d.unitId, d.name, d.departmentName, d.id].some(x => key(x) === k)) : null;
  };
  const findDesignation = (v) => {
    const k = key(v);
    return designations.find(d => key(d.designationCode) === k || key(d.designationName) === k) || null;
  };

  // 1. what can be saved
  const ok = [];
  records.forEach((r) => {
    if (byEmail.has(r.email)) return errors.push(`${r.email}: already an employee (${byEmail.get(r.email)}); not imported again.`);
    const dept = r.department ? findDept(r.department) : null;
    if (r.department && !dept) return errors.push(`${r.email}: department "${r.department}" does not exist. Import or create it first.`);
    ok.push({ ...r, dept, des: r.designation ? findDesignation(r.designation) : null });
  });

  // 2. IDs. The organisation's counter can only be moved by the server, so this
  // continues from the highest ID in use - the same rule Add Employee falls back to.
  let ids = null;
  if (deps.allocateIds && ok.length) { try { ids = await deps.allocateIds(ok.length); } catch (_) { ids = null; } }
  if (!ids || ids.length !== ok.length) {
    let max = 0;
    existing.forEach(e => { const m = String(e.employeeId || e.id || '').match(/^EMP(\d+)$/i); if (m) max = Math.max(max, Number(m[1])); });
    ids = ok.map((_, i) => 'EMP' + String(max + i + 1).padStart(4, '0'));
  }
  ok.forEach((r, i) => { r.employeeId = ids[i]; byEmail.set(r.email, ids[i]); });

  // 3. reporting managers: an email or an employee ID, existing or in this file
  const knownIds = new Set([...existing.map(e => String(e.employeeId || e.id).toUpperCase()), ...ok.map(r => r.employeeId)]);
  const resolveManager = (v) => {
    if (!v) return '';
    if (v.includes('@')) return byEmail.get(v.toLowerCase()) || null;
    return knownIds.has(v.toUpperCase()) ? v.toUpperCase() : null;
  };

  for (const r of ok) {
    const managerId = resolveManager(r.reportingManager);
    if (managerId === null) { errors.push(`${r.email}: reporting manager "${r.reportingManager}" is not an employee.`); continue; }
    const record = {
      id: r.employeeId, uid: r.employeeId, employeeId: r.employeeId,
      name: r.name, fullName: r.name, email: r.email, role: r.role,
      departmentId: r.dept ? r.dept.id : '',
      departmentName: r.dept ? (r.dept.name || r.dept.departmentName || '') : '',
      departmentCode: r.dept ? (r.dept.departmentCode || r.dept.unitId || '') : '',
      designation: r.des ? r.des.designationCode : r.designation,
      designationCode: r.des ? r.des.designationCode : r.designation,
      businessUnitCode: r.businessUnit, subDepartmentCode: r.subDepartment,
      reportingManagerId: managerId, managers: { l1ManagerId: managerId, l2ManagerId: '' },
      joiningDate: r.joiningDate,
      status: 'Active', invite_status: 'draft', source: 'bulk_import',
      createdAt: new Date().toISOString()
    };
    try {
      await setDoc(doc(db, 'employees', r.employeeId), record, { merge: true });
      await setDoc(doc(db, 'users', r.employeeId), record, { merge: true });
      saved++;
    } catch (e) { errors.push(`${r.email}: ${e.message}`); }
  }
  return { saved, errors, ids: ok.map(r => r.employeeId) };
}

const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/** Preview markup for one kind: what will be saved, and why any row will not. */
export function previewHtml(kind, sheetName, parsed) {
  const def = REFERENCE_KINDS[kind];
  const cols = kind === 'employees' ? ['name', 'email', 'role', 'department', 'designation', 'reportingManager']
    : kind === 'locations' ? ['code', 'name', 'state', 'country'] : kind === 'designations' ? ['code', 'name', 'departmentCode'] : ['code', 'name', 'costCenterCode'];
  const head = cols.map(c => `<th style="text-align:left;padding:8px 10px;font-size:.75rem;color:var(--k-muted)">${esc(c)}</th>`).join('');
  const body = parsed.records.slice(0, 200).map(r => '<tr>' + cols.map(c => `<td style="padding:8px 10px;border-top:1px solid var(--k-border);font-size:.85rem">${esc(r[c])}</td>`).join('') + '</tr>').join('');
  const errs = parsed.errors.length
    ? `<div role="alert" style="margin:12px 0;padding:10px 12px;border-radius:10px;background:var(--k-warning-soft);color:var(--k-warning-text);border:1px solid var(--k-warning-border);font-size:.85rem"><strong>${parsed.errors.length} row(s) will not be imported:</strong><br>${parsed.errors.slice(0, 8).map(esc).join('<br>')}${parsed.errors.length > 8 ? '<br>...' : ''}</div>` : '';
  const after = kind === 'employees' ? '<p style="font-size:.8rem;color:var(--k-muted);margin:8px 0 0">Saving creates the employee records. Use <strong>Issue Logins &amp; Invites</strong> afterwards to give them access.</p>' : '';
  return `<div class="reference-import" style="background:var(--k-surface);border:1px solid var(--k-border);border-radius:16px;padding:1.25rem;margin-top:1.25rem">
      <div style="display:flex;justify-content:space-between;align-items:center;gap:1rem;flex-wrap:wrap">
        <div><h3 style="margin:0;font-size:1rem;color:var(--k-text)">${esc(def.title)} (${parsed.records.length} ready)</h3>
        <p style="margin:2px 0 0;font-size:.8rem;color:var(--k-muted)">From sheet "${esc(sheetName)}". Nothing is saved until you press Save.</p></div>
        <button type="button" class="btn btn-primary" data-reference-save="${kind}" ${parsed.records.length ? '' : 'disabled'}>Save ${parsed.records.length} ${esc(def.title.toLowerCase())}</button>
      </div>${errs}
      <div style="overflow-x:auto;margin-top:12px"><table style="width:100%;border-collapse:collapse"><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table></div>${after}
    </div>`;
}
