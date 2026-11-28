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
  /**
   * 22 undifferentiated chips, each ending in "(PRD §1, §4, §11 & §13)", could not be
   * scanned. They are now four labelled groups, and the six statutory masters - which
   * differed from one another by a few letters - sit behind one tab.
   */
  it('is grouped rather than one long row', () => {
    assert.ok(tabIds.length <= 18, 'the bar has grown back to ' + tabIds.length + ' tabs');
    for (const group of ['Add data', 'Organisation', 'Time off & attendance', 'Pay & compliance']) {
      assert.ok(html.includes('>' + group + '<'), 'missing the ' + group + ' group');
    }
  });

  it('drops the repeated PRD reference from every chip', () => {
    const bar = html.slice(html.indexOf('id="setupMethodTabs"'), html.indexOf('id="setupMethodTabs"') + 6000);
    assert.ok(!/PRD §/.test(bar), 'the same citation on 22 chips is what made the bar unreadable');
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

describe('the three duplicate bulk tabs are gone', () => {
  /**
   * Job & Rosters, Finance & Statutory IDs and Org Statutory Registrations were wired -
   * by unifiedIngestionUIController.js, not by this file, which is why an earlier pass
   * here wrongly called them unbuilt and disabled them. What they did was worse than
   * nothing: in the browser window.db is the modular Firestore instance, which has no
   * .batch(), and window.firestoreModules was never defined, so neither write branch ran
   * - yet every row was counted a success and the page announced "Successfully committed
   * N records to Cloud Firestore". "Triggered N Decentro Penny Drop verifications" was
   * announced the same way, without any call being made.
   *
   * Had the writes worked they would have done damage: users/{employeeCode} (user docs
   * are keyed by auth uid), full bank account numbers copied into a top-level
   * bank_verifications collection, and salary_structures overwritten with an invented
   * 50/40 Basic/HRA split. The Finance tab's parser was handed raw bytes where it
   * expects rows and threw on every file.
   *
   * The Bulk File Upload tab already imports Employee Finance and Statutory Compliance
   * through code that writes for real, so the duplicates were removed, not repaired.
   */
  it('has no tab or panel for them', () => {
    for (const id of ['tabUnifiedJobRoster', 'tabUnifiedEmployeeFinance', 'tabUnifiedOrgCompliance',
                      'unifiedJobRosterView', 'unifiedEmployeeFinanceView', 'unifiedOrgComplianceView']) {
      assert.ok(!html.includes('id="' + id + '"'), id + ' is back');
      assert.ok(!js.includes("'" + id + "'"), id + ' is still looked up');
    }
  });

  it('loads none of their scripts, which are deleted', () => {
    for (const f of ['jobRosterParser.js', 'orgComplianceParser.js', 'unifiedIngestionService.js', 'unifiedIngestionUIController.js']) {
      assert.ok(!html.includes('src="' + f + '"'), f + ' is still loaded');
      assert.ok(!fs.existsSync(path.join(ROOT, f)), f + ' is back');
    }
    assert.ok(!/UnifiedIngestionUIController/.test(html));
  });
});

describe('the statutory masters share one tab', () => {
  it('the six old tabs are gone from the bar', () => {
    for (const id of ['tabEpfoMaster','tabEsicMaster','tabPtMaster','tabLwfMaster','tabNpsMaster','tabGratuityMaster']) {
      assert.ok(!html.includes('id="' + id + '"'), id + ' is still a top-level tab');
    }
  });

  it('one tab replaces them, with a chooser inside', () => {
    assert.ok(html.includes('id="tabStatutoryMasters"'));
    assert.ok(html.includes('id="statutoryMastersView"'));
    assert.equal((html.match(/class="statutory-master-btn"/g) || []).length, 6, 'expected six choices');
  });

  it('each choice still renders its own table', () => {
    for (const fn of ['renderOnboardingEpfoMasterTable', 'renderOnboardingEsicMasterTable',
                      'renderOnboardingPtMasterTable', 'renderOnboardingLwfMasterTable',
                      'renderOnboardingNpsMasterTable', 'renderOnboardingGratuityMasterTable']) {
      assert.ok(js.includes(fn), fn + ' is no longer called');
    }
  });

  /**
   * The six panels are no longer entries in TABS, so the loop that hides every panel on
   * a tab change does not reach them. Without an explicit sweep, opening EPFO and then
   * switching tabs leaves the EPFO table on screen underneath the new one.
   */
  it('hides the master panels when another tab is opened', () => {
    const body = js.slice(js.indexOf('function showTab(key)'), js.indexOf('function showTab(key)') + 900);
    assert.match(body, /STATUTORY_MASTERS/, 'switching away would leave a master panel visible');
  });

  it('a master that fails to render does not break the tab', () => {
    assert.ok(js.includes("console.warn('[ONBOARDING] '"), 'a failing master should be caught, not thrown');
  });
});
