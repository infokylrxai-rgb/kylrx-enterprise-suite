/**
 * tvc-dashboard.html (Workforce Monitor): the AI and payroll panels must never stay on
 * "Loading...". renderPanels() is taken from the page source and run against a stub DOM.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const html = fs.readFileSync(fileURLToPath(new URL('../tvc-dashboard.html', import.meta.url)), 'utf8').replace(/\r\n/g, '\n');

const PANELS = ['burnoutVal', 'riskVal', 'predictionText', 'finPayroll', 'finBurn'];

function run(state) {
  const start = html.indexOf('        function renderPanels() {');
  const end = html.indexOf('        async function loadTelemetry()');
  assert.ok(start > 0 && end > start, 'renderPanels not found in tvc-dashboard.html');

  const elements = {};
  for (const id of [...PANELS, 'burnoutBar', 'riskBar']) elements[id] = { textContent: 'Loading...', style: {} };
  const context = vm.createContext({
    document: { getElementById: (id) => elements[id] || null },
    _state: state
  });
  vm.runInContext(html.slice(start, end) + '\nrenderPanels();', context);
  return elements;
}

const base = { users: [], activity: {}, attendance: {}, adminSessions: [], error: null };

describe('Workforce Monitor panels', () => {
  it('a brand-new organization shows honest empty states, not "Loading..."', () => {
    const el = run({ ...base });
    assert.equal(el.finPayroll.textContent, 'No payroll data yet');
    assert.equal(el.burnoutVal.textContent, 'No data yet');
    assert.equal(el.riskVal.textContent, 'No data yet');
    assert.match(el.predictionText.textContent, /No workforce telemetry yet/);
    for (const id of PANELS) assert.doesNotMatch(el[id].textContent, /Loading|Analyzing/, id);
  });

  it('a failed or timed-out load shows the real error in every panel', () => {
    const el = run({ ...base, error: 'the server did not answer within 8 seconds' });
    assert.match(el.predictionText.textContent, /the server did not answer within 8 seconds/);
    for (const id of ['burnoutVal', 'riskVal', 'finPayroll', 'finBurn']) assert.equal(el[id].textContent, 'Unavailable', id);
  });

  it('real data produces real figures', () => {
    const el = run({
      ...base,
      users: [{ id: 'u1', salary: 1200000 }, { id: 'u2', salary: 600000 }, { id: 'u3' }],
      activity: {
        u1: { tabSwitchCount: 9, aiProductivityScore: 80 },
        u2: { tabSwitchCount: 1, aiProductivityScore: 20 },
        u3: { tabSwitchCount: 0 }
      }
    });
    assert.equal(el.finPayroll.textContent, '₹1,50,000'); // (1,200,000 + 600,000) / 12
    assert.equal(el.burnoutVal.textContent, '33%'); // 1 of 3 switches tabs a lot
    assert.equal(el.riskVal.textContent, 'Elevated'); // 1 flagged => 25
    assert.match(el.predictionText.textContent, /1 of 3 active people are flagged/);
  });

  it('loadTelemetry has a timeout and renders the panels on failure too', () => {
    assert.match(html, /AbortSignal\.timeout\(TELEMETRY_TIMEOUT_MS\)/);
    const load = html.slice(html.indexOf('async function loadTelemetry()'), html.indexOf('function initTelemetry()'));
    assert.equal((load.match(/renderPanels\(\)/g) || []).length, 2, 'renderPanels must run on success and on failure');
  });
});
