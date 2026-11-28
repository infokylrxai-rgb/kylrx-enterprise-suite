/**
 * Boots admin-onboarding-upload.js in a simulated page so tests can drive it the way a
 * person does: drop a file on the drop zone, read what appears, press Ingest.
 *
 * The page's own parser scripts (the plain <script src> tags in the HTML) are loaded
 * first, as the browser would, so sections that delegate to window.Kylrx*Parser use the
 * real parsers rather than their fallbacks. Firebase is replaced by
 * fixtures/firebase-config-mock.mjs; register fixtures/redirect-onboarding.mjs first.
 */
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const require = createRequire(import.meta.url);
export const XLSX = require(path.join(ROOT, 'node_modules', 'xlsx'));

function makeElement(id) {
  const el = {
    id, tagName: 'DIV', innerHTML: '', innerText: '', textContent: '', value: '', disabled: false,
    title: '', hidden: false, dataset: {}, children: [], attrs: {},
    style: {},
    classList: {
      _s: new Set(),
      add(...c) { c.forEach(x => this._s.add(x)); }, remove(...c) { c.forEach(x => this._s.delete(x)); },
      contains(c) { return this._s.has(c); }, toggle(c, on) { (on ?? !this._s.has(c)) ? this._s.add(c) : this._s.delete(c); }
    },
    setAttribute(k, v) { this.attrs[k] = String(v); }, getAttribute(k) { return this.attrs[k] ?? null; },
    removeAttribute(k) { delete this.attrs[k]; },
    addEventListener() {}, removeEventListener() {},
    appendChild(c) { this.children.push(c); return c; }, insertBefore(c) { this.children.push(c); return c; },
    remove() {}, click() { if (typeof this.onclick === 'function') this.onclick({ preventDefault() {} }); },
    querySelector() { return null; }, querySelectorAll() { return []; }, closest() { return null; },
    focus() {}, scrollIntoView() {}, reset() {}
  };
  el.parentElement = { insertBefore() {}, appendChild() {} };
  return el;
}

export async function bootOnboardingPage() {
  const els = new Map();
  const getEl = (id) => { if (!els.has(id)) els.set(id, makeElement(id)); return els.get(id); };
  let ready = null;
  const store = new Map();

  globalThis.window = globalThis;
  globalThis.document = {
    readyState: 'loading',
    getElementById: getEl,
    querySelector: () => null,
    querySelectorAll: () => [],
    createElement: (t) => Object.assign(makeElement(null), { tagName: String(t).toUpperCase() }),
    addEventListener: (type, fn) => { if (type === 'DOMContentLoaded') ready = fn; },
    body: makeElement('body'),
    documentElement: makeElement('html')
  };
  globalThis.localStorage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k)
  };
  Object.defineProperty(globalThis, 'location', { value: { hash: '', href: 'http://localhost/admin-onboarding-upload.html' }, configurable: true, writable: true });
  globalThis.history = { replaceState() {} };
  // The real firebase-config.js publishes this on window for the classic scripts.
  globalThis.getActiveOrgId = () => (globalThis.__fbMock && globalThis.__fbMock.orgId) || 'org_test';
  // A signed-in admin, and a backend that accepts what it is sent. Nothing leaves the
  // process: every request is recorded in __fbMock.requests instead.
  globalThis.auth = { currentUser: { uid: 'test-admin', getIdToken: async () => 'test-token' } };
  globalThis.fetch = async (url, init = {}) => {
    ((globalThis.__fbMock ||= { writes: [] }).requests ||= []).push({ url: String(url), method: init.method || 'GET' });
    if (globalThis.__fbMock.failFetch) return { ok: false, status: 500, json: async () => ({ error: 'server unavailable' }) };
    return { ok: true, status: 200, json: async () => ({ success: true }) };
  };
  globalThis.XLSX = XLSX;
  globalThis.FileReader = class {
    readAsArrayBuffer(file) { setImmediate(() => this.onload({ target: { result: file.bytes } })); }
  };

  // The page's classic scripts, in page order.
  const html = fs.readFileSync(path.join(ROOT, 'admin-onboarding-upload.html'), 'utf8');
  const scripts = [...html.matchAll(/<script src="([^":]+\.js)"><\/script>/g)].map(m => m[1])
    .filter(s => s !== 'kylrx-theme-init.js');
  const scriptErrors = [];
  for (const s of scripts) {
    const file = path.join(ROOT, s);
    if (!fs.existsSync(file)) { scriptErrors.push(s + ': missing'); continue; }
    // import('./firebase-config.js') inside these scripts goes through the normal loader,
    // so the registered redirect hands them the stand-in, as the page hands them the real one.
    try { vm.runInThisContext(fs.readFileSync(file, 'utf8'), { filename: file, importModuleDynamically: vm.constants.USE_MAIN_CONTEXT_DEFAULT_LOADER }); }
    catch (err) { scriptErrors.push(s + ': ' + err.message); }
  }

  await import(pathToFileURL(path.join(ROOT, 'admin-onboarding-upload.js')).href + '?t=' + Date.now());
  if (ready) await ready();

  const alerts = [];
  window.showCustomAlert = (title, msg, type) => alerts.push({ title, msg, type });

  /** Choose a file through the real file input, as the drop zone does. */
  async function upload(name, workbookOrBytes) {
    const bytes = workbookOrBytes instanceof Uint8Array || Buffer.isBuffer(workbookOrBytes)
      ? workbookOrBytes
      : XLSX.write(workbookOrBytes, { type: 'buffer', bookType: 'xlsx' });
    const input = getEl('fileInput');
    input.value = 'C:\\fakepath\\' + name;
    await input.onchange({ target: input, currentTarget: input, files: [{ name, bytes }] });
    // FileReader.onload runs on the next turn; then the async sections inside it.
    for (let i = 0; i < 20; i++) await new Promise(r => setImmediate(r));
  }
  // The real handler reads e.target.files, so give the input the files too.
  const realInput = getEl('fileInput');
  const origOnchange = realInput.onchange;
  realInput.onchange = (e) => origOnchange({ target: Object.assign(realInput, { files: e.files }) });

  /** Forget what the last upload rendered and said, so the next one is read on its own. */
  function reset() {
    alerts.length = 0;
    for (const e of els.values()) { e.innerText = ''; e.textContent = ''; e.innerHTML = ''; }
    globalThis.__fbMock = { writes: [] };
  }

  return { el: getEl, alerts, upload, reset, scriptErrors, XLSX };
}

/*
 * The page's classic scripts declare top-level consts, so running them twice in one
 * process throws. A test file boots the page once and resets between cases.
 */
let booted = null;
export function onboardingPage() {
  return (booted ||= bootOnboardingPage());
}

/** Build a workbook from { sheetName: [ {col: value}, ... ] | [] (headers only via {__headers}) }. */
export function workbook(sheets) {
  const wb = XLSX.utils.book_new();
  for (const [name, rows] of Object.entries(sheets)) {
    const ws = Array.isArray(rows)
      ? XLSX.utils.json_to_sheet(rows)
      : XLSX.utils.aoa_to_sheet([rows.__headers]);
    XLSX.utils.book_append_sheet(wb, ws, name);
  }
  return wb;
}
