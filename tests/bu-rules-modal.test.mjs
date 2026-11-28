/**
 * "Business Unit & Employee Type Rules" modal (bu-employee-type-rules.js) in jsdom against a stubbed Firebase.
 * The organization comes from the verified token (never localStorage), every record carries orgId, the
 * legacy bu_employee_type_rules collection is untouched, and a failed save is shown instead of looking saved.
 */
import { describe, it, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { JSDOM } = require('jsdom');
const source = fs.readFileSync(fileURLToPath(new URL('../bu-employee-type-rules.js', import.meta.url)), 'utf8');

const windows = [];
after(() => windows.forEach(w => w.close()));
const tick = (ms = 10) => new Promise((resolve) => setTimeout(resolve, ms));

function boot({ orgId = 'org_a', setDocError = null, apiStatus = 200, loadError = null, stored = [] } = {}) {
  const dom = new JSDOM('<!doctype html><body><div id="buRulesTableContainer"></div></body>', { url: 'http://localhost/admin-settings.html', runScripts: 'outside-only', pretendToBeVisual: true });
  const { window } = dom;
  windows.push(window);
  window.localStorage.setItem('orgId', 'org_from_localstorage'); // must be ignored
  const rec = { writes: [], deletes: [], reads: [], fetches: [], toasts: [] };
  const ref = (_db, ...parts) => ({ path: parts.join('/') });
  window.KylrxFirebase = {
    db: {}, tenantReady: Promise.resolve(), getActiveOrgId: () => orgId,
    collection: ref, doc: ref,
    query: (base, ...c) => ({ path: base.path, constraints: c }),
    where: (...w) => ({ where: w }),
    serverTimestamp: () => 'ts',
    getDocs: async (q) => {
      rec.reads.push(q.path);
      if (loadError) throw new Error(loadError);
      const docs = q.path.endsWith('/business_units') ? stored : [];
      return { empty: docs.length === 0, forEach: (fn) => docs.forEach(d => fn({ id: d.businessUnitCode, data: () => d })) };
    },
    setDoc: async (r, data) => { rec.writes.push([r.path, data]); if (setDocError) throw new Error(setDocError); },
    deleteDoc: async (r) => { rec.deletes.push(r.path); }
  };
  window.auth = { currentUser: { getIdToken: async () => 'verified-token' } };
  window.fetch = async (url, opts) => {
    rec.fetches.push([String(url), opts && opts.method, opts && opts.headers, opts && opts.body]);
    return { ok: apiStatus < 400, status: apiStatus, json: async () => (apiStatus < 400 ? { success: true } : { error: 'Server said no' }) };
  };
  window.showToast = (message, kind) => rec.toasts.push([message, kind]);
  window.eval(source);
  return { window, document: window.document, rec, bu: window.KylrxBuRules };
}

async function fillAndSubmit(ctx, code = 'BU_NEW', name = 'New Unit') {
  await ctx.bu.openBuModal();
  const d = ctx.document;
  d.getElementById('buModalCode').value = code;
  d.getElementById('buModalName').value = name;
  await ctx.bu.handleModalSubmit();
}

const modalOpen = (d) => d.getElementById('buEditModal').style.display !== 'none';

describe('BU rules modal: saving', () => {
  it('writes organizations/<org>/business_units with orgId, tells the backend, closes and toasts success', async () => {
    const ctx = boot();
    await tick();
    await fillAndSubmit(ctx);
    assert.equal(ctx.rec.writes.length, 1);
    const [path, data] = ctx.rec.writes[0];
    assert.equal(path, 'organizations/org_a/business_units/BU_NEW');
    assert.equal(data.orgId, 'org_a');
    assert.equal(data.businessUnitCode, 'BU_NEW');
    const post = ctx.rec.fetches.find(f => f[1] === 'POST');
    assert.ok(post, 'the backend API was not called');
    assert.equal(post[2].Authorization, 'Bearer verified-token');
    assert.equal(JSON.parse(post[3]).orgId, 'org_a');
    assert.ok(!modalOpen(ctx.document), 'the modal should close after a real success');
    assert.deepEqual(ctx.rec.toasts.map(t => t[1]), ['success']);
    assert.ok(ctx.bu.getRuleByCode('BU_NEW'));
  });

  it('never touches the legacy bu_employee_type_rules collection, and ignores localStorage orgId', async () => {
    const ctx = boot();
    await tick();
    await fillAndSubmit(ctx);
    await ctx.bu.loadRulesFromFirestore();
    const touched = [...ctx.rec.writes.map(w => w[0]), ...ctx.rec.deletes, ...ctx.rec.reads];
    assert.ok(touched.length > 0);
    assert.deepEqual(touched.filter(p => p.includes('bu_employee_type_rules') || p.includes('org_from_localstorage') || p.includes('org_kylrx')), []);
  });

  it('a failed Firestore write shows the real error, keeps the modal open and does not toast success', async () => {
    const ctx = boot({ setDocError: 'Missing or insufficient permissions.' });
    await tick();
    await fillAndSubmit(ctx);
    assert.ok(modalOpen(ctx.document), 'the modal closed although the save failed');
    assert.match(ctx.document.getElementById('buModalError').textContent, /Missing or insufficient permissions/);
    assert.deepEqual(ctx.rec.toasts, []);
    assert.equal(ctx.rec.fetches.filter(f => f[1] === 'POST').length, 0, 'the API was called after the database refused');
    assert.ok(!ctx.bu.getRuleByCode('BU_NEW'), 'a failed save must not stay in the local list');
    assert.equal(ctx.document.getElementById('btnBuModalSave').disabled, false, 'the user can retry');
  });

  it('a failed backend call is an error too, and the Firestore write is undone', async () => {
    const ctx = boot({ apiStatus: 500 });
    await tick();
    await fillAndSubmit(ctx);
    assert.ok(modalOpen(ctx.document));
    assert.match(ctx.document.getElementById('buModalError').textContent, /Server said no/);
    assert.deepEqual(ctx.rec.toasts, []);
    assert.deepEqual(ctx.rec.deletes, ['organizations/org_a/business_units/BU_NEW']);
    assert.ok(!ctx.bu.getRuleByCode('BU_NEW'));
  });
});

describe('BU rules modal: no organization', () => {
  it('says so, disables Save and writes nothing (localStorage orgId is not a fallback)', async () => {
    const ctx = boot({ orgId: null });
    await tick();
    await ctx.bu.openBuModal();
    assert.equal(ctx.document.getElementById('buModalOrgNotice').textContent, 'Your account has no organization');
    assert.equal(ctx.document.getElementById('btnBuModalSave').disabled, true);
    await assert.rejects(ctx.bu.saveRule({ businessUnitCode: 'BU_X', businessUnitName: 'X' }), /no organization/);
    assert.deepEqual(ctx.rec.writes, []);
    assert.equal(ctx.rec.fetches.length, 0);
  });
});

describe('BU rules modal: loading', () => {
  it('reads only this organization\'s business_units and shows what is stored', async () => {
    const ctx = boot({ stored: [{ businessUnitCode: 'bu_hr', businessUnitName: 'HR Unit', allowedEmployeeTypes: ['FULL_TIME'], isActive: true }] });
    await ctx.bu.loadRulesFromFirestore();
    assert.ok(ctx.rec.reads.includes('organizations/org_a/business_units'));
    assert.deepEqual(ctx.rec.reads.filter(p => p.includes('bu_employee_type_rules')), []);
    assert.equal(ctx.bu.getRuleByCode('BU_HR').businessUnitName, 'HR Unit');
    assert.equal(ctx.bu.getLoadError(), null);
  });

  it('a failed read rejects and is kept in getLoadError (no silent empty list)', async () => {
    const ctx = boot({ loadError: 'Missing or insufficient permissions.' });
    await assert.rejects(ctx.bu.loadRulesFromFirestore(), /insufficient permissions/);
    assert.match(ctx.bu.getLoadError().message, /insufficient permissions/);
  });

  it('the employee list is queried by organization', async () => {
    const ctx = boot();
    await ctx.bu.fetchActiveEmployees();
    assert.ok(ctx.rec.reads.includes('users'));
  });
});

/**
 * The rules screen rendered a six-column table and squeezed ten employee-type chips into
 * one narrow cell, so each wrapped onto its own line and a row became a column of stacked
 * pills. It also listed the same type two or three times, because two code schemes name
 * the same concepts: FULL_TIME and CAT_FT_REG are both "Full-Time Regular".
 */
describe('the rules screen is readable', () => {
  const src = source;   // already read at the top of this file

  it('lays the business units out as cards, not a cramped table', () => {
    assert.match(src, /bu-rules-list/, 'expected the card list container');
    assert.ok(!/<th style="padding: 14px 16px; font-weight: 800;">Allowed Employee Types/.test(src),
      'the narrow Allowed Employee Types column should be gone');
  });

  it('collapses the duplicate labels into one chip each', () => {
    assert.match(src, /const byLabel = new Map\(\)/, 'types must be de-duplicated by label');
    assert.match(src, /uniqueTypes/, 'the render must use the de-duplicated list');
  });

  it('keeps a chip switched on when any of its alias codes is allowed', () => {
    // FULL_TIME and CAT_FT_REG are the same thing; a rule naming either must light the
    // single chip, or turning it off would silently leave the other code allowed.
    assert.match(src, /t\.aliases\.some\(code => allowed\.includes\(code\)\)/);
  });
});
