/**
 * Bulk onboarding, driven the way a person uses it: choose a workbook through the
 * page's own file input, read what the page shows and says, press Ingest.
 *
 * admin-onboarding-upload.js runs here unmodified, with the page's own parser scripts
 * loaded first as the browser loads them (fixtures/onboarding-page.mjs). Only Firebase
 * is replaced, by a stand-in that records writes and can be told to fail.
 *
 * Every case below was a real failure before this file existed:
 *  - shifts typed into the template's "Shifts & Week-offs" sheet were never imported;
 *  - with two spellings of one sheet, the empty one was read and the filled one ignored;
 *  - uploading the full template crashed at Statutory Compliance (an undeclared
 *    variable), so roles, workflows and payroll components were never read, and the
 *    message blamed the file;
 *  - a sheet whose rows were all rejected showed nothing at all, not even why;
 *  - an import where every write failed said "Partial Ingest" and the button then read
 *    "Ingestion Complete";
 *  - choosing the same file again, after correcting it, did nothing;
 *  - gratuity rows carrying another organisation's ID were accepted and saved.
 */
import { describe, it, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { register, createRequire } from 'node:module';

register('./fixtures/redirect-onboarding.mjs', import.meta.url);
const { onboardingPage, workbook, ROOT, XLSX } = await import('./fixtures/onboarding-page.mjs');
const require = createRequire(import.meta.url);
const { SHEETS } = require(path.join(ROOT, 'scripts', 'create-import-template.js'));

const DEV_TEMPLATE = path.join(ROOT, 'assets', 'Templates.xlsx');
const CUSTOMER_TEMPLATE = path.join(ROOT, 'assets', 'Kylrx-Import-Template.xlsx');

// The preview heading each section writes when it has rows to show.
const TITLES = {
  'Organization': 'parseResultMeta',
  'Business Unit': 'buParseResultTitle', 'Cost Center': 'ccParseResultTitle',
  'Sub-Departments': 'subDeptParseResultTitle', 'Employee Type': 'employeeTypeParseResultTitle',
  'Shifts & Week-offs': 'shiftParseResultTitle', 'Attendance Rules': 'policyParseResultTitle',
  'Holiday Calendar': 'holidayCalendarParseResultTitle', 'Payroll Components': 'payrollComponentsParseResultTitle',
  'Salary Structure': 'salaryStructureParseResultTitle', 'Employee Finance Details': 'employeeFinanceParseResultTitle',
  'PF Details': 'epfoMasterParseResultTitle', 'ESIC Details': 'esicMasterParseResultTitle',
  'PT Details': 'ptMasterParseResultTitle', 'LWF Details': 'lwfMasterParseResultTitle',
  'NPS Details': 'npsMasterParseResultTitle', 'Gratuity Details': 'gratuityMasterParseResultTitle',
  'Statutory Compliance': 'statutoryComplianceParseResultTitle', 'Role Permissions': 'rolePermissionParseResultTitle',
  'Workflow Rules': 'workflowRulesParseResultTitle'
};

/** Rows from the development workbook, cut to the given headers. */
function sampleRows(fromSheet, headers) {
  const dev = XLSX.readFile(DEV_TEMPLATE);
  return XLSX.utils.sheet_to_json(dev.Sheets[fromSheet], { defval: '' })
    .map(r => Object.fromEntries(headers.map(h => [h, r[h] ?? ''])));
}

let page;
const shown = (id) => page.el(id).innerText || page.el(id).textContent || '';
before(async () => { page = await onboardingPage(); });
beforeEach(() => page.reset());

describe('the page loads as the browser loads it', () => {
  it('every script the page includes runs', () => {
    assert.deepEqual(page.scriptErrors, []);
  });
});

describe('the template customers download', () => {
  it('has one sheet per kind of record, each read by its importer', async () => {
    const tpl = XLSX.readFile(CUSTOMER_TEMPLATE);
    assert.equal(tpl.SheetNames[0], 'Read Me');
    assert.deepEqual(tpl.SheetNames.slice(1), SHEETS.map(s => s[0]));

    // Filled with the development workbook's sample rows, every sheet must preview.
    for (const name of tpl.SheetNames.slice(1)) {
      const headers = XLSX.utils.sheet_to_json(tpl.Sheets[name], { header: 1 })[0];
      const from = SHEETS.find(s => s[0] === name)[1];
      tpl.Sheets[name] = XLSX.utils.json_to_sheet(sampleRows(from, headers), { header: headers });
    }
    await page.upload('Kylrx-Import-Template.xlsx', tpl);

    const missing = Object.entries(TITLES).filter(([, id]) => !shown(id)).map(([sheet]) => sheet);
    assert.deepEqual(missing, [], 'these sheets produced no preview');
    assert.deepEqual(page.alerts, [], 'a correctly filled template should raise nothing');
  });

  it('ships no sample rows that could be imported by accident', () => {
    const tpl = XLSX.readFile(CUSTOMER_TEMPLATE);
    for (const name of tpl.SheetNames.slice(1)) {
      assert.equal(XLSX.utils.sheet_to_json(tpl.Sheets[name]).length, 0, name + ' has data rows');
    }
  });

  it('does not ask for an Organization ID, which is filled in for you', () => {
    const tpl = XLSX.readFile(CUSTOMER_TEMPLATE);
    for (const name of tpl.SheetNames.slice(1)) {
      const headers = XLSX.utils.sheet_to_json(tpl.Sheets[name], { header: 1 })[0] || [];
      assert.ok(!headers.includes('Organization ID'), name + ' still asks for it');
    }
  });

  it('is what both download buttons serve', () => {
    const html = fs.readFileSync(path.join(ROOT, 'admin-onboarding-upload.html'), 'utf8');
    const js = fs.readFileSync(path.join(ROOT, 'admin-onboarding-upload.js'), 'utf8');
    assert.equal((html.match(/href="assets\/Kylrx-Import-Template\.xlsx"/g) || []).length, 2);
    assert.match(js, /link\.href = 'assets\/Kylrx-Import-Template\.xlsx'/);
    assert.ok(!/href="assets\/Templates\.xlsx"/.test(html), 'the development workbook is still offered');
  });

  it('matches what the generator produces from the development workbook', () => {
    const before = XLSX.readFile(CUSTOMER_TEMPLATE);
    const tmp = path.join(ROOT, 'assets', '.check-template.xlsx');
    const gen = fs.readFileSync(path.join(ROOT, 'scripts', 'create-import-template.js'), 'utf8')
      .replace("'../assets/Kylrx-Import-Template.xlsx'", "'../assets/.check-template.xlsx'");
    const m = { exports: {} };
    new Function('require', 'module', '__dirname', gen)(require, m, path.join(ROOT, 'scripts'));
    try {
      m.exports.build();
      const fresh = XLSX.readFile(tmp);
      assert.deepEqual(fresh.SheetNames, before.SheetNames);
      for (const n of fresh.SheetNames) {
        assert.deepEqual(XLSX.utils.sheet_to_json(fresh.Sheets[n], { header: 1 }),
          XLSX.utils.sheet_to_json(before.Sheets[n], { header: 1 }), n + ' is stale: run node scripts/create-import-template.js');
      }
    } finally { fs.rmSync(tmp, { force: true }); }
  });
});

describe('sheets are found the way people name them', () => {
  it('reads shifts from "Shifts & Week-offs"', async () => {
    const headers = ['Shift_Code', 'Shift_Name', 'Start_Time', 'End_Time', 'Break_Minutes', 'Grace_In_Minutes',
      'Grace_Out_Minutes', 'Half_Day_Minutes', 'Full_Day_Minutes', 'Night_Shift', 'Overtime_Eligible', 'Weekly_Off_Pattern', 'Active'];
    await page.upload('shifts.xlsx', workbook({ 'Shifts & Week-offs': sampleRows('Shifts & Week-offs', headers) }));
    assert.match(shown('shiftParseResultTitle'), /\(5 Schedules\)/);
  });

  it('reads the filled copy when an empty sheet of the same kind comes first', async () => {
    const headers = ['Cost_Center_Code', 'Cost_Center_Name', 'Owner Employee ID', 'Active'];
    await page.upload('cc.xlsx', workbook({
      'Cost Center': { __headers: headers },
      'Cost Centre': [{ Cost_Center_Code: 'CC-OPS', Cost_Center_Name: 'Operations', 'Owner Employee ID': '', Active: 'Yes' }]
    }));
    assert.match(shown('ccParseResultTitle'), /\(1 Units\)/);
  });
});

describe('a sheet is read by its own importer and no other', () => {
  /*
   * A file holding only "PF Details" was also claimed by Employee Finance, whose
   * fallback accepted any sheet with an Employee ID column, and the PF rows were offered
   * for import as bank details. Each kind of sheet, alone in a file, must produce
   * exactly one preview: its own.
   */
  for (const [name, from] of SHEETS) {
    it(name, async () => {
      const headers = XLSX.utils.sheet_to_json(XLSX.readFile(CUSTOMER_TEMPLATE).Sheets[name], { header: 1 })[0];
      await page.upload(name + '.xlsx', workbook({ [name]: sampleRows(from, headers) }));
      const previews = Object.entries(TITLES).filter(([, id]) => shown(id)).map(([sheet]) => sheet);
      assert.deepEqual(previews, [name]);
    });
  }
});

describe('the whole development workbook', () => {
  it('is read to the last sheet without crashing', async () => {
    await page.upload('Templates.xlsx', fs.readFileSync(DEV_TEMPLATE));
    for (const id of ['statutoryComplianceParseResultTitle', 'rolePermissionParseResultTitle',
                      'workflowRulesParseResultTitle', 'payrollComponentsParseResultTitle']) {
      assert.ok(shown(id), id + ' never rendered: the upload stopped before it');
    }
    assert.ok(!page.alerts.some(a => a.title === 'Could Not Read File'), JSON.stringify(page.alerts));
  });
});

describe('the page says what it did not import', () => {
  it('names the sheets when none of them is one it imports', async () => {
    await page.upload('notes.xlsx', workbook({ 'My Notes': [{ a: 1 }], 'Budget': [{ b: 2 }] }));
    assert.equal(page.alerts.length, 1);
    assert.equal(page.alerts[0].title, 'Nothing To Import');
    assert.match(page.alerts[0].msg, /My Notes, Budget/);
  });

  it('gives the reason when every row of a sheet is rejected', async () => {
    const headers = XLSX.utils.sheet_to_json(XLSX.readFile(DEV_TEMPLATE).Sheets['PF Details'], { header: 1 })[0];
    const rows = sampleRows('PF Details', headers).map(r => ({ ...r, 'Organization ID': 'ORG_SOMEONE_ELSE' }));
    await page.upload('pf.xlsx', workbook({ 'PF Details': rows }));
    assert.equal(shown('epfoMasterParseResultTitle'), '', 'no preview for rows that were all rejected');
    assert.equal(page.alerts.length, 1);
    assert.equal(page.alerts[0].title, 'Nothing Could Be Imported');
    assert.match(page.alerts[0].msg, /"PF Details": no row could be used/);
    assert.match(page.alerts[0].msg, /ORG_SOMEONE_ELSE/);
  });

  it('lists a filled-in sheet it did not read, alongside one it did', async () => {
    await page.upload('mixed.xlsx', workbook({
      'Business Unit': [{ Business_Unit_Code: 'BU-QA-UPLOAD', Business_Unit_Name: 'Operations', Head_Employee_ID: '', Active: 'Yes' }],
      'Leave_Types': [{ Leave_Code: 'CL', Leave_Name: 'Casual', Annual_Quota: 12 }]
    }));
    assert.ok(shown('buParseResultTitle'));
    assert.equal(page.alerts.length, 1, 'one message, not one per problem');
    assert.equal(page.alerts[0].type, 'warning');
    assert.match(page.alerts[0].msg, /Leave_Types/);
    assert.match(page.alerts[0].msg, /Nothing is saved until you press Ingest/);
  });

  it('saves nothing just because a file was read', async () => {
    await page.upload('Templates.xlsx', fs.readFileSync(DEV_TEMPLATE));
    assert.deepEqual(globalThis.__fbMock.writes, []);
  });
});

describe('choosing the file again', () => {
  it('clears the file input, so the corrected file can be chosen again', async () => {
    await page.upload('bu.xlsx', workbook({ 'Business Unit': [{ Business_Unit_Code: 'BU-A', Business_Unit_Name: 'A', Head_Employee_ID: '', Active: 'Yes' }] }));
    assert.equal(page.el('fileInput').value, '', 'a kept value means choosing the same file fires no change');
  });
});

describe('Ingest reports what was saved', () => {
  async function parseOneBusinessUnit() {
    await page.upload('bu.xlsx', workbook({ 'Business Unit': [{ Business_Unit_Code: 'BU-QA-UPLOAD', Business_Unit_Name: 'Operations', Head_Employee_ID: '', Active: 'Yes' }] }));
    page.alerts.length = 0;
  }

  it('says nothing was saved when every write fails, and offers to try again', async () => {
    await parseOneBusinessUnit();
    globalThis.__fbMock.failSetDoc = true;
    await page.el('btnConfirmBuIngest').onclick();
    const last = page.alerts[page.alerts.length - 1];
    assert.equal(last.title, 'Nothing Was Saved');
    assert.equal(last.type, 'error');
    assert.match(page.el('btnConfirmBuIngest').innerHTML, /Try Again/);
    assert.doesNotMatch(page.el('btnConfirmBuIngest').innerHTML, /Ingestion Complete/);
  });

  it('calls it complete only when everything was written', async () => {
    await parseOneBusinessUnit();
    await page.el('btnConfirmBuIngest').onclick();
    assert.equal(page.alerts[page.alerts.length - 1].type, 'success');
    assert.match(page.el('btnConfirmBuIngest').innerHTML, /Ingestion Complete/);
    assert.ok(globalThis.__fbMock.writes.some(w => /business_units\/BU-QA-UPLOAD$/.test(w.path)), 'the business unit was written');
  });

  it('every importer distinguishes nothing saved from partly saved', () => {
    const js = fs.readFileSync(path.join(ROOT, 'admin-onboarding-upload.js'), 'utf8');
    const partial = (js.match(/"Partial Ingest"/g) || []).length;
    const nothing = (js.match(/"Nothing Was Saved"/g) || []).length;
    assert.ok(partial >= 19);
    assert.equal(nothing, partial, 'an importer can still call a total failure partial');
    assert.ok(!/innerHTML = '<i data-lucide="check-circle-2"><\/i> Ingestion Complete';/.test(js),
      'a button that says complete regardless of errors');
  });
});

describe('gratuity rows belong to this organisation', () => {
  it('rejects rows carrying another organisation\'s ID instead of saving them', async () => {
    const headers = XLSX.utils.sheet_to_json(XLSX.readFile(DEV_TEMPLATE).Sheets['Gratuity Details'], { header: 1 })[0];
    const rows = sampleRows('Gratuity Details', headers).map(r => ({ ...r, 'Organization ID': 'ORG_SOMEONE_ELSE' }));
    await page.upload('gratuity.xlsx', workbook({ 'Gratuity Details': rows }));
    assert.equal(shown('gratuityMasterParseResultTitle'), '');
    assert.match(page.alerts[0].msg, /does not match current tenant context/);
  });

  it('keeps no row that failed validation', () => {
    const parsed = window.KylrxGratuityDetailsParser.parseSheetRows(
      [{ 'Gratuity Applicable': 'Yes', 'Date of Joining': '2020-01-01' }],   // no Employee ID
      { orgId: 'org_test' });
    assert.equal(parsed.records.length, 0);
    assert.equal(parsed.firestoreDocs.length, 0, 'an invalid row would be written on Ingest');
    assert.ok(parsed.errors.length > 0);
  });
});

describe('the page speaks to customers, not developers', () => {
  const html = fs.readFileSync(path.join(ROOT, 'admin-onboarding-upload.html'), 'utf8');
  const js = fs.readFileSync(path.join(ROOT, 'admin-onboarding-upload.js'), 'utf8');

  it('shows no internal field names on buttons or badges', () => {
    assert.ok(!/orgConfigured: (true|false)\)/.test(html + js), 'a badge still shows orgConfigured');
    assert.ok(!/Set orgConfigured/.test(html + js), 'a button still says Set orgConfigured');
  });

  it('has no button that fills the organisation form with Kylrx\'s own details', () => {
    assert.ok(!html.includes('btnFillDemoData'));
    // "e.g. AAACK1234F" in a validation message is a format hint; filling a field with it is not.
    assert.ok(!/manualPan: "/.test(js), 'the form is still filled with an invented PAN');
    assert.ok(!/manualLegalName: "Kylrx/.test(js));
  });

  it('the drop zone can be reached and used from the keyboard', () => {
    assert.equal(page.el('dropZone').getAttribute('role'), 'button');
    assert.equal(page.el('dropZone').getAttribute('tabindex'), '0');
    let opened = 0;
    page.el('fileInput').click = () => { opened++; };
    page.el('dropZone').onkeydown({ key: 'Enter', preventDefault() {} });
    assert.equal(opened, 1);
  });
});

describe('business units show only this organisation\'s data', () => {
  /*
   * bu-employee-type-rules.js started with five sample business units and seven sample
   * people, and kept them whenever an organisation had none of its own. A new customer
   * saw them as theirs, and could make an invented person the head of a business unit.
   */
  it('lists none of the sample business units', () => {
    const samples = new Set(window.KylrxBuRules.DEFAULT_BU_RULES.map(r => r.businessUnitCode.toUpperCase()));
    const shownCodes = window.KylrxBuRules.getAllRules().map(r => r.businessUnitCode);
    assert.deepEqual(shownCodes.filter(c => samples.has(c)), []);
    assert.ok(!window.KylrxBuRules.getAllRules().some(r => r.isSeed));
  });

  it('offers no invented people as a business unit head', () => {
    const src = fs.readFileSync(path.join(ROOT, 'bu-employee-type-rules.js'), 'utf8');
    assert.ok(!/let activeEmployeesCache = \[\.\.\.CANONICAL_ACTIVE_EMPLOYEES\]/.test(src));
    assert.ok(!/if \(loaded\.length > 0\) activeEmployeesCache = loaded/.test(src),
      'an organisation with nobody would fall back to the sample people');
  });
});
