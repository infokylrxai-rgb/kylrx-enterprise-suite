/**
 * The onboarding page has 22 tabs. Three of them did nothing when clicked: Job & Rosters
 * Bulk, Finance & Statutory IDs Bulk, and Org Statutory Registrations Bulk.
 *
 * Their panels were fully built in the markup, and so were their buttons - but neither
 * was ever looked up in script, so they could not be registered in the tab table. A tab
 * missing from that table is silently inert: showTab returns early and nothing happens.
 *
 * Nothing tells you about a tab that quietly does nothing, so this counts them.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const html = fs.readFileSync(path.join(ROOT, 'admin-onboarding-upload.html'), 'utf8');
const js = fs.readFileSync(path.join(ROOT, 'admin-onboarding-upload.js'), 'utf8');

const tabIds = [...html.matchAll(/<button class="tab-btn[^"]*" id="(tab[A-Za-z0-9_]+)"/g)].map(m => m[1]);
const registry = js.slice(js.indexOf('const TABS = {'), js.indexOf('function showTab'));

describe('every onboarding tab opens something', () => {
  it('finds all the tabs', () => {
    assert.ok(tabIds.length >= 22, 'expected at least 22 tabs, found ' + tabIds.length);
  });

  it('every tab button is looked up in script', () => {
    const missing = tabIds.filter(id => !js.includes("getElementById('" + id + "')"));
    assert.deepEqual(missing, [], 'never looked up, so never wired: ' + missing.join(', '));
  });

  it('every tab is in the registry, so clicking it does something', () => {
    const missing = tabIds.filter(id => !registry.includes('[' + id + ','));
    assert.deepEqual(missing, [], 'missing from TABS, so inert when clicked: ' + missing.join(', '));
  });

  it('every registered panel exists in the markup', () => {
    const views = [...registry.matchAll(/\[tab[A-Za-z0-9_]+,\s*([a-zA-Z0-9_]+)/g)].map(m => m[1]);
    const missing = views.filter(v => !js.includes("getElementById('" + v + "')"));
    assert.deepEqual(missing, [], 'panels referenced but never looked up: ' + missing.join(', '));
  });
});

describe('a panel that is not built says so', () => {
  /**
   * These three panels have a template button, a drop zone, a file input and an ingest
   * button, none of which is referenced anywhere in script. Now that the tabs open, a
   * dead file picker would be worse than the dead tab: somebody would drop a file in and
   * wait for an import that is never going to happen.
   */
  it('disables the controls that were never implemented', () => {
    assert.match(js, /function markBulkPanelUnavailable/);
    assert.match(js, /is not built yet/);
  });

  it('points at what does work instead', () => {
    assert.match(js, /Bulk File Upload tab/);
  });

  it('is applied to all three of them', () => {
    for (const label of ['Job & Rosters', 'Finance & Statutory IDs', 'Org Statutory Registrations']) {
      assert.ok(js.includes(label), 'no notice for ' + label);
    }
  });
});
