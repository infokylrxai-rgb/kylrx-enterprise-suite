/**
 * custom-apps.js: per-organization custom apps for the admin sidebar and App Registry.
 * Runs the real module in jsdom against stubbed Firebase: https-only links, textContent
 * rendering (no HTML injection), the organization's own document, and safe add / remove.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { JSDOM } = require('jsdom');

const source = fs.readFileSync(fileURLToPath(new URL('../custom-apps.js', import.meta.url)), 'utf8')
  .replace(/^import .*$/gm, '')
  .replace(/^export /gm, '');
const EXPORTS = ['safeAppUrl', 'cleanAppName', 'validApps', 'renderApps', 'addCustomApp', 'removeCustomApp', 'initCustomApps'];

function load({ orgId = 'org_a', snapshot = null, setDoc } = {}) {
  const dom = new JSDOM(`<div id="customAppsList"></div><div id="registryAppsList"></div>
    <div id="customAppsModal" style="display:none"></div><input id="appUrlInput"><input id="appNameInput">`, { runScripts: 'outside-only' });
  const { window } = dom;
  const calls = { setDoc: [], subscribed: [], alerts: [], removed: [] };
  window.__stubs = {
    db: {},
    doc: (_db, ...segments) => ({ path: segments.join('/') }),
    onSnapshot: (ref, onNext) => { calls.subscribed.push(ref.path); if (snapshot) onNext(snapshot); return () => {}; },
    setDoc: async (ref, data, opts) => { calls.setDoc.push([ref.path, data, opts]); return setDoc ? setDoc() : undefined; },
    arrayUnion: (x) => ({ union: x }),
    arrayRemove: (x) => ({ remove: x }),
    tenantReady: Promise.resolve(),
    getActiveOrgId: () => orgId
  };
  window.alert = (m) => calls.alerts.push(m);
  window.eval(`window.api = (function () { const { ${Object.keys(window.__stubs).join(', ')} } = window.__stubs; ${source}; return { ${EXPORTS.join(', ')} }; })();`);
  return { window, document: window.document, api: window.api, calls };
}
const tick = () => new Promise((resolve) => setTimeout(resolve, 5));
const plain = (x) => JSON.parse(JSON.stringify(x)); // values from the jsdom realm

describe('custom apps: links', () => {
  const { api } = load();
  it('accepts https and bare host names, and normalizes them', () => {
    assert.equal(api.safeAppUrl('example.com'), 'https://example.com/');
    assert.equal(api.safeAppUrl('  https://app.datadoghq.com/x?y=1 '), 'https://app.datadoghq.com/x?y=1');
  });
  it('rejects every other scheme, credentials in the URL, and junk', () => {
    for (const bad of ['javascript:alert(1)', 'JAVASCRIPT:alert(1)', ' javascript:alert(1)', 'data:text/html,<script>alert(1)</script>',
      'http://example.com', 'ftp://example.com', 'vbscript:x', 'https://user:pw@example.com', '', 'https://', '   ']) {
      assert.equal(api.safeAppUrl(bad), null, bad);
    }
  });
  it('drops stored entries that are not safe, whatever wrote them', () => {
    const kept = api.validApps([
      { name: 'Good', url: 'https://ok.example/' },
      { name: 'Evil', url: 'javascript:alert(1)' },
      { name: 'Data', url: 'data:text/html,x' },
      { name: '', url: 'https://ok.example/' },
      { name: 'Not normalized', url: 'https://ok.example' },
      null, 'x'
    ]);
    assert.deepEqual(plain(kept), [{ name: 'Good', url: 'https://ok.example/' }]);
  });
});

describe('custom apps: rendering', () => {
  it('renders names as text, never as HTML, and links only to https', () => {
    const { document, api } = load();
    api.renderApps([
      { name: '<img src=x onerror="alert(1)">', url: 'https://ok.example/' },
      { name: 'Bad link', url: 'javascript:alert(1)' }
    ]);
    const list = document.getElementById('customAppsList');
    assert.equal(list.querySelectorAll('img').length, 0, 'the name was parsed as HTML');
    assert.equal(list.querySelectorAll('a').length, 1);
    const a = list.querySelector('a');
    assert.equal(a.getAttribute('href'), 'https://ok.example/');
    assert.equal(a.getAttribute('rel'), 'noopener noreferrer');
    assert.equal(a.querySelector('span').textContent, '<img src=x onerror="alert(1)">');
    assert.equal(document.querySelectorAll('[onclick]').length, 0, 'no inline handlers');
    assert.equal(document.getElementById('registryAppsList').querySelectorAll('span').length, 1);
  });

  it('the remove buttons pass the exact stored values', () => {
    const { document, api, window } = load();
    const removed = [];
    window.removeAppFromServer = (url, name) => removed.push([url, name]);
    api.renderApps([{ name: "O'Brien \"apps\"", url: 'https://ok.example/' }]);
    document.querySelector('#customAppsList button').click();
    document.querySelector('#registryAppsList button').click();
    assert.deepEqual(removed, [['https://ok.example/', "O'Brien \"apps\""], ['https://ok.example/', "O'Brien \"apps\""]]);
  });
});

describe('custom apps: storage', () => {
  it('reads and writes only the signed-in organization\'s document', async () => {
    const { api, calls, document } = load({ orgId: 'org_a', snapshot: { exists: () => true, data: () => ({ customApps: [{ name: 'Mine', url: 'https://mine.example/' }] }) } });
    api.initCustomApps();
    await tick();
    assert.deepEqual(calls.subscribed, ['organizations/org_a/config/admin_custom_apps']);
    assert.equal(document.querySelector('#customAppsList span').textContent, 'Mine');

    await api.addCustomApp('example.com', '  My   App ');
    assert.deepEqual(plain(calls.setDoc), [['organizations/org_a/config/admin_custom_apps', { customApps: { union: { name: 'My App', url: 'https://example.com/' } } }, { merge: true }]]);
    assert.ok(!JSON.stringify(calls).includes('system_configs'), 'the old shared document is never used');
  });

  it('refuses unsafe links before writing, and tells the user', async () => {
    const { window, document, calls } = load();
    window.eval('window.api.initCustomApps()');
    document.getElementById('appUrlInput').value = 'javascript:alert(1)';
    await window.addCustomApp();
    assert.equal(calls.setDoc.length, 0);
    assert.match(calls.alerts[0], /Only https:\/\/ links are allowed/);
  });

  it('a user with no organization gets no list and writes nothing', async () => {
    const { api, calls, document } = load({ orgId: null });
    api.initCustomApps();
    await tick();
    assert.deepEqual(calls.subscribed, []);
    assert.equal(document.getElementById('customAppsList').children.length, 0);
    await assert.rejects(api.addCustomApp('example.com', 'x'), /No organization/);
    assert.equal(calls.setDoc.length, 0);
  });

  it('a failed remove is reported, not swallowed', async () => {
    const { window, calls } = load({ setDoc: () => { throw new Error('permission-denied'); } });
    window.eval('window.api.initCustomApps()');
    await window.removeAppFromServer('https://ok.example/', 'Good');
    assert.match(calls.alerts[0], /Could not remove the app: permission-denied/);
  });
});
