/**
 * Renders a page in headless Chrome in a chosen theme and measures the contrast of
 * every visible piece of text against the background actually behind it.
 *
 *   node tools/contrast-audit.js admin-document-templates.html [dark|light]
 *
 * The page is served from disk. Firebase is stubbed as a signed-in admin, and /api/
 * calls are answered from fixtures, so the page renders its real content without a
 * live backend. Prints each text that falls below WCAG AA (4.5:1, or 3:1 for large
 * text) and exits non-zero if any does.
 */
const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer');

const ROOT = path.resolve(__dirname, '..');
const page = process.argv[2] || 'admin-document-templates.html';
const theme = process.argv[3] || 'dark';
const ORIGIN = 'http://kylrx.test';

// Saved from the template engine, so this tool never initialises Firebase.
function templatesFixture() {
  return JSON.parse(fs.readFileSync(path.join(ROOT, 'tests', 'fixtures', 'document-templates.json'), 'utf8'));
}

const FIREBASE_STUB = `
const user = { uid: 'u1', email: 'admin@example.com', getIdToken: async () => 't', getIdTokenResult: async () => ({ claims: { orgId: 'org_a', role: 'super_admin' } }) };
export const auth = { currentUser: user, onAuthStateChanged: (cb) => { cb(user); return () => {}; } };
export const db = {};
export const tenantReady = Promise.resolve('org_a');
export const getActiveOrgId = () => 'org_a';
const snap = { empty: true, docs: [], size: 0, forEach() {}, exists: () => false, data: () => ({}) };
export const collection = () => ({}); export const doc = () => ({}); export const query = (x) => x; export const where = () => ({}); export const orderBy = () => ({}); export const limit = () => ({});
export const getDocs = async () => snap; export const getDoc = async () => snap;
export const onSnapshot = (t, next) => { setTimeout(() => next(snap)); return () => {}; };
export const setDoc = async () => {}; export const addDoc = async () => ({ id: 'x' }); export const updateDoc = async () => {}; export const deleteDoc = async () => {};
export const serverTimestamp = () => null; export const arrayUnion = (...a) => a; export const arrayRemove = (...a) => a;
export const registerListener = () => {}; export const runTransaction = async () => {}; export const writeBatch = () => ({ set() {}, update() {}, commit: async () => {} });
export default {};
`;
const AUTH_STUB = `export function onAuthStateChanged(a, cb) { cb(a && a.currentUser); return () => {}; } export function signOut() { return Promise.resolve(); } export function getAuth() { return {}; }`;

(async () => {
  const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox'] });
  const tab = await browser.newPage();
  await tab.setViewport({ width: 1366, height: 900 });
  await tab.evaluateOnNewDocument((t) => { try { localStorage.setItem('kylrx_theme', t); } catch (_) {} }, theme);
  const templates = templatesFixture();
  await tab.setRequestInterception(true);
  tab.on('request', (req) => {
    const url = new URL(req.url());
    if (/firebase-auth\.js$/.test(url.pathname)) return req.respond({ contentType: 'text/javascript', body: AUTH_STUB });
    if (url.hostname !== 'kylrx.test') return req.respond({ status: 204, body: '' });   // no outside calls
    if (/\/firebase-config\.js$/.test(url.pathname)) return req.respond({ contentType: 'text/javascript', body: FIREBASE_STUB });
    // FAIL_FIRST=1: the first templates request fails, as on a cold server, to check the page recovers by itself.
    if (process.env.FAIL_FIRST && url.pathname === '/api/document-templates' && !global.__failedOnce) {
      global.__failedOnce = true;
      return req.respond({ status: 503, contentType: 'application/json', body: JSON.stringify({ success: false, error: 'Service waking up' }) });
    }
    if (url.pathname.startsWith('/api/')) {
      const body = url.pathname === '/api/document-templates' ? { success: true, data: templates }
        : url.pathname.startsWith('/api/firestore/write-status') ? { accepting: true }
        : { success: true, data: [] };
      return req.respond({ contentType: 'application/json', body: JSON.stringify(body) });
    }
    const file = path.join(ROOT, decodeURIComponent(url.pathname));
    if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) return req.respond({ status: 404, body: '' });
    const type = file.endsWith('.html') ? 'text/html' : file.endsWith('.css') ? 'text/css' : file.endsWith('.js') ? 'text/javascript' : file.endsWith('.svg') ? 'image/svg+xml' : 'application/octet-stream';
    req.respond({ contentType: type, body: fs.readFileSync(file) });
  });
  await tab.goto(`${ORIGIN}/${page}`, { waitUntil: 'load', timeout: 30000 });
  await new Promise(r => setTimeout(r, 4500));

  const result = await tab.evaluate(() => {
    const parse = (c) => { const m = c.match(/rgba?\(([^)]+)\)/); if (!m) return null; const p = m[1].split(/[ ,/]+/).filter(Boolean).map(Number); return { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 }; };
    const lum = ({ r, g, b }) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); };
    const blend = (top, bottom) => ({ r: top.r * top.a + bottom.r * (1 - top.a), g: top.g * top.a + bottom.g * (1 - top.a), b: top.b * top.a + bottom.b * (1 - top.a), a: 1 });
    function bgOf(el) {
      const layers = [];
      for (let n = el; n && n.nodeType === 1; n = n.parentElement) {
        const cs = getComputedStyle(n);
        if (cs.backgroundImage && cs.backgroundImage !== 'none') return null;          // gradient/image: skip
        const c = parse(cs.backgroundColor);
        if (c && c.a > 0) { layers.push(c); if (c.a >= 1) break; }
      }
      let out = { r: 255, g: 255, b: 255, a: 1 };
      for (let i = layers.length - 1; i >= 0; i--) out = blend(layers[i], out);
      return out;
    }
    const failures = [];
    let checked = 0;
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    const seen = new Set();
    while (walker.nextNode()) {
      const t = walker.currentNode;
      const text = t.textContent.trim();
      const el = t.parentElement;
      if (!text || !el || seen.has(el)) continue;
      seen.add(el);
      const r = el.getBoundingClientRect();
      const cs = getComputedStyle(el);
      if (r.width === 0 || r.height === 0 || cs.visibility === 'hidden' || cs.display === 'none' || parseFloat(cs.opacity) === 0) continue;
      let hidden = false;
      for (let n = el; n; n = n.parentElement) { const s = getComputedStyle(n); if (s.display === 'none' || s.visibility === 'hidden' || parseFloat(s.opacity) === 0) { hidden = true; break; } }
      if (hidden) continue;
      const fg = parse(cs.color); const bg = bgOf(el);
      if (!fg || !bg) continue;
      const f = blend(fg, bg);
      const L1 = lum(f), L2 = lum(bg);
      const ratio = (Math.max(L1, L2) + 0.05) / (Math.min(L1, L2) + 0.05);
      const size = parseFloat(cs.fontSize), weight = parseInt(cs.fontWeight, 10) || 400;
      const large = size >= 24 || (size >= 18.66 && weight >= 700);
      const need = large ? 3 : 4.5;
      checked++;
      if (ratio < need) failures.push({ text: text.slice(0, 40), ratio: ratio.toFixed(2), need, color: cs.color, bg: `rgb(${Math.round(bg.r)}, ${Math.round(bg.g)}, ${Math.round(bg.b)})`, sel: el.tagName.toLowerCase() + (el.id ? '#' + el.id : '') + (el.className && typeof el.className === 'string' ? '.' + el.className.trim().split(/\s+/).slice(0, 2).join('.') : '') });
    }
    return { theme: document.documentElement.getAttribute('data-theme'), checked, failures, bodyBg: getComputedStyle(document.body).backgroundColor, cards: document.querySelectorAll('#template-grid > *').length, loadError: /Could not load templates/.test(document.body.innerText) };
  });
  await tab.screenshot({ path: path.join(process.env.CONTRAST_SHOT_DIR || ROOT, `contrast-${page.replace('.html', '')}-${theme}.png`) });
  await browser.close();
  console.log(`${page} [${result.theme}] body ${result.bodyBg}; ${result.cards} cards; load error shown: ${result.loadError}; ${result.checked} texts checked; ${result.failures.length} below AA`);
  const grouped = {};
  for (const f of result.failures) { const k = f.color + ' on ' + f.bg; (grouped[k] ||= []).push(f); }
  for (const [k, list] of Object.entries(grouped).sort((a, b) => b[1].length - a[1].length)) {
    console.log(`  ${String(list.length).padStart(3)} x ${k} (ratio ${list[0].ratio}, need ${list[0].need}) e.g. "${list[0].text}" <${list[0].sel}>`);
  }
  process.exitCode = result.failures.length ? 1 : 0;
})().catch(err => { console.error(err); process.exit(2); });
