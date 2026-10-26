/**
 * employee-docs.html: runs the page's real module script in jsdom against stubbed Firebase.
 * The payslip query is scoped to the signed-in session's organization AND uid; neither localStorage
 * nor ?id= can point it at someone else, and no demo persona is in the page.
 */
import { describe, it, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { JSDOM } = require('jsdom');
const html = fs.readFileSync(fileURLToPath(new URL('../employee-docs.html', import.meta.url)), 'utf8').replace(/\r\n/g, '\n');
const moduleSource = [...html.matchAll(/<script type="module">([\s\S]*?)<\/script>/g)].map(m => m[1]).find(s => s.includes('loadEmployeeDocs'));
const importedNames = [...moduleSource.matchAll(/^\s*import \{([^}]*)\} from/gm)].flatMap(m => m[1].split(',').map(x => x.trim()).filter(Boolean)).map(x => x.split(/\s+as\s+/).pop());
const body = moduleSource.replace(/^\s*import .*$/gm, '');
const markup = html.replace(/<script[\s\S]*?<\/script>/g, '');

const ME = { uid: 'emp-1', orgId: 'org_a', role: 'Employee' };
const windows = [];
after(() => windows.forEach(w => w.close()));
const tick = (ms = 15) => new Promise((resolve) => setTimeout(resolve, ms));

function boot({ signedIn = true, identityFails = false, docs = [], search = '?id=someone_else', local = {} } = {}) {
  const dom = new JSDOM(markup, { url: 'http://localhost/employee-docs.html' + search, runScripts: 'outside-only', pretendToBeVisual: true });
  const { window } = dom;
  windows.push(window);
  for (const [k, v] of Object.entries(local)) window.localStorage.setItem(k, v);
  const rec = { queries: [] };
  const stubs = Object.fromEntries(importedNames.map(n => [n, () => ({})]));
  Object.assign(stubs, {
    db: {}, auth: { currentUser: signedIn ? { uid: ME.uid } : null },
    onAuthStateChanged: (_a, cb) => cb(signedIn ? { uid: ME.uid, displayName: 'Eve Employee' } : null),
    checkBackendFirebaseStatus: async () => ({ online: true }),
    collection: (_db, col) => ({ col }),
    doc: (_db, col, id) => ({ path: `${col}/${id}` }),
    where: (...w) => ({ where: w }),
    whereMyOrg: () => ({ mine: true, where: ['orgId', '==', ME.orgId] }),
    orderBy: (...o) => ({ order: o }),
    query: (base, ...constraints) => { const q = { col: base.col, constraints }; rec.queries.push(q); return q; },
    getDocs: async () => ({ docs: docs.map(d => ({ id: d.id, data: () => d })) }),
    onSnapshot: () => () => {},
    registerListener: () => {},
    loadIdentity: async () => { if (identityFails) throw new Error('No organization found for the signed-in user.'); return ME; }
  });
  window.__stubs = stubs;
  window.lucide = { createIcons: () => {} };
  window.eval(`(function () { const { ${Object.keys(stubs).join(', ')} } = window.__stubs; ${body} })();`);
  return { window, document: window.document, rec };
}

describe('employee-docs.html', () => {
  it('has no demo persona or hard-coded user id in the page', () => {
    for (const bad of ['John Doe', 'Marry', 'demo_emp', 'ZnaGIFv88QRD8AD4xTJOJ1KZinE2', 'Cybersecurity']) assert.ok(!html.includes(bad), `${bad} is still in the page`);
  });

  it('queries payroll_documents by the signed-in organization and uid, whatever ?id= or localStorage say', async () => {
    const { rec } = boot({ search: '?id=someone_else', local: { employee_uid: 'attacker', hr_user_id: 'attacker' } });
    await tick();
    const q = rec.queries.find(x => x.col === 'payroll_documents');
    assert.ok(q, 'no payroll_documents query');
    assert.ok(q.constraints.some(c => c.mine), 'no organization filter');
    assert.ok(q.constraints.some(c => c.where && c.where[0] === 'employeeId' && c.where[2] === ME.uid), 'not filtered to the signed-in uid');
    assert.ok(!JSON.stringify(q).includes('someone_else') && !JSON.stringify(q).includes('attacker'));
  });

  it('lists only payslips and invoices that came back', async () => {
    const { document } = boot({ docs: [{ id: 'd1', docType: 'Payslip', period: '2026-09', employeeId: ME.uid }, { id: 'd2', docType: 'Offer', employeeId: ME.uid }] });
    await tick();
    assert.equal(document.querySelectorAll('.doc-item').length, 1);
    assert.match(document.getElementById('docCountBadge').textContent, /1 PAYSLIP/);
  });

  it('when the organization cannot be verified it says so and queries nothing', async () => {
    const { document, rec } = boot({ identityFails: true });
    await tick();
    assert.equal(rec.queries.filter(q => q.col === 'payroll_documents').length, 0);
    assert.match(document.getElementById('docGrid').textContent, /Could not verify your account/);
  });

  it('signed out: nothing is queried', async () => {
    const { rec } = boot({ signedIn: false });
    await tick();
    assert.equal(rec.queries.length, 0);
  });
});
