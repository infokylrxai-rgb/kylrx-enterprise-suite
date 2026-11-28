/**
 * Builds assets/Kylrx-Import-Template.xlsx, the workbook customers download from the
 * onboarding page.
 *
 *   node scripts/create-import-template.js
 *
 * assets/Templates.xlsx is the development workbook: 67 sheets, several spellings of
 * the same sheet ("Cost Center" and "Cost Centre"), 23 sheets that no importer reads,
 * and sample rows for a made-up organisation. The parser tests use it as a fixture, so
 * it stays as it is. Handing it to a customer was the problem: they could not tell
 * which of three Salary Structure sheets to fill in, rows typed into an unread sheet
 * were never imported, and the sample rows belong to an organisation ID that is not
 * theirs, so every statutory row was rejected.
 *
 * This template has exactly one sheet for each kind of record the page imports, named
 * as its importer expects, with header rows only, and a Read Me sheet first. Headers
 * are copied from assets/Templates.xlsx so the two cannot drift apart.
 */
const path = require('path');
const XLSX = require('xlsx');

const SOURCE = path.resolve(__dirname, '../assets/Templates.xlsx');
const OUT = path.resolve(__dirname, '../assets/Kylrx-Import-Template.xlsx');

// [sheet in this template, sheet its headers come from, what it holds, notes]
const SHEETS = [
  ['Organization', 'Organization', 'Your company\'s legal and contact details.', 'One row.'],
  ['Locations', 'Locations_Branches', 'Offices and branches.', 'Is_Headquarters: Yes for one location.'],
  ['Business Unit', 'Business Unit', 'Business units.', 'Head_Employee_ID can be left empty until employees exist.'],
  ['Cost Center', 'Cost Center', 'Cost centres.', ''],
  ['Departments', 'Departments', 'Departments.', 'Cost_Center_Code should be a cost centre from the Cost Center sheet.'],
  ['Designations', 'Designations', 'Job titles offered on the employee form.', 'Department_Code is optional.'],
  ['Sub-Departments', 'Sub-Departments', 'Sub-departments.', 'Cost_Center_Code must be a cost centre from the Cost Center sheet or already saved.'],
  ['Employees', 'Employees_Master', 'Your people, one row each.', 'Department must exist (this file or already saved). Role: Employee, Manager or HR. Reporting Manager: an email or employee ID. Logins are issued afterwards with Issue Logins & Invites.'],
  ['Employee Type', 'Employee Type', 'Employee categories, probation and notice periods.', ''],
  ['Shifts & Week-offs', 'Shifts & Week-offs', 'Shift timings and weekly offs.', 'Times as HH:MM, 24-hour.'],
  ['Attendance Rules', 'Attendance Rules', 'Late, early-leaving, regularisation and overtime rules.', ''],
  ['Holiday Calendar', 'Holiday Calendar', 'Holidays, one row per holiday.', 'Dates as YYYY-MM-DD.'],
  ['Payroll Components', 'Payroll Components', 'Earnings and deductions used in salary structures.', 'Fill this before Salary Structure.'],
  ['Salary Structure', 'Salary Structure', 'Each employee\'s pay, one row per component.', 'Employee_ID must be an existing employee. Component_Code must be a payroll component.'],
  ['Employee Finance Details', 'Employee Finance Details', 'Bank accounts and statutory numbers.', 'Employee_ID must be an existing employee.'],
  ['PF Details', 'PF Details', 'EPFO membership per employee.', 'Employee ID must be an existing employee.'],
  ['ESIC Details', 'ESIC Details', 'ESIC membership per employee.', 'Employee ID must be an existing employee.'],
  ['PT Details', 'PT Details', 'Professional tax per employee.', 'Employee ID must be an existing employee.'],
  ['LWF Details', 'LWF Details', 'Labour welfare fund per employee.', 'Employee ID must be an existing employee.'],
  ['NPS Details', 'NPS Details', 'NPS membership per employee.', 'Employee ID must be an existing employee.'],
  ['Gratuity Details', 'Gratuity Details', 'Gratuity eligibility per employee.', 'Employee ID must be an existing employee.'],
  ['Statutory Compliance', 'Statutory Compliance', 'Your PF, ESIC, PT and LWF registrations and rates.', ''],
  ['Role Permissions', 'Role_Permissions', 'Roles and what each may do.', ''],
  ['Workflow Rules', 'Workflow Rules', 'Approval chains, one row per step.', 'Step_No starts at 1 with no gaps.']
];

// Filled in for the person importing; asking for it only invited a mismatch.
const DROP = new Set(['Organization ID']);

function build() {
  const src = XLSX.readFile(SOURCE);
  const wb = XLSX.utils.book_new();

  const readMe = [
    ['Kylrx import template'],
    [],
    ['Fill in the sheets you need and leave the others empty. Empty sheets are skipped.'],
    ['Keep the sheet names and the header row as they are: that is how each sheet is recognised.'],
    ['Nothing is saved when you upload. Each sheet is shown for review first, with its own Ingest button.'],
    ['Rows that cannot be used are listed with the reason, so you can correct them and upload again.'],
    [],
    ['Sheet', 'What it holds', 'Notes']
  ];
  for (const [name, , what, notes] of SHEETS) readMe.push([name, what, notes]);
  const rm = XLSX.utils.aoa_to_sheet(readMe);
  rm['!cols'] = [{ wch: 26 }, { wch: 58 }, { wch: 72 }];
  XLSX.utils.book_append_sheet(wb, rm, 'Read Me');

  for (const [name, from] of SHEETS) {
    const ws = src.Sheets[from];
    if (!ws) throw new Error('assets/Templates.xlsx has no sheet "' + from + '"');
    const header = (XLSX.utils.sheet_to_json(ws, { header: 1 })[0] || []).filter(h => !DROP.has(String(h).trim()));
    if (!header.length) throw new Error('"' + from + '" has no header row');
    const out = XLSX.utils.aoa_to_sheet([header]);
    out['!cols'] = header.map(h => ({ wch: Math.max(14, String(h).length + 2) }));
    XLSX.utils.book_append_sheet(wb, out, name);
  }

  XLSX.writeFile(wb, OUT);
  return { file: OUT, sheets: wb.SheetNames.length };
}

if (require.main === module) {
  const r = build();
  console.log('Wrote ' + path.relative(process.cwd(), r.file) + ' (' + r.sheets + ' sheets)');
}

module.exports = { build, SHEETS };
