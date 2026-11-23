/**
 * Chat cache in localStorage is owned by the signed-in uid: user B on the same browser never sees user A's
 * cached messages, and logout clears everything. Unit tests for chat-cache.js, then the real admin-message and
 * employee-message scripts in jsdom with a shared localStorage that holds user A's cache.
 */
import { describe, it, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { chatCache, syncChatCacheOwner, clearChatCaches, CHAT_CACHE_PREFIX } from '../chat-cache.js';

const require = createRequire(import.meta.url);
const { JSDOM } = require('jsdom');
const read = (f) => fs.readFileSync(fileURLToPath(new URL(`../${f}`, import.meta.url)), 'utf8').replace(/\r\n/g, '\n');
const memory = () => {
  const m = new Map();
  return { get length() { return m.size; }, key: (i) => [...m.keys()][i] ?? null, getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k), clear: () => m.clear(), keys: () => [...m.keys()] };
};

describe('chat-cache.js', () => {
  it('a user only reads their own cached messages', () => {
    const store = memory();
    chatCache('userA', store).set('fs_col_messages', [{ id: 1, text: 'secret of A' }]);
    assert.deepEqual(chatCache('userA', store).get('fs_col_messages', []), [{ id: 1, text: 'secret of A' }]);
    assert.deepEqual(chatCache('userB', store).get('fs_col_messages', []), [], 'B read the messages of A');
    assert.deepEqual(chatCache(null, store).get('fs_col_messages', []), []);
    chatCache(null, store).set('x', 1);
    assert.ok(!store.keys().some(k => k.endsWith(':x')), 'a cache with no uid stored something');
  });

  it('when the signed-in user changes, the other user entries and the old un-keyed ones are deleted', () => {
    const store = memory();
    chatCache('userA', store).set('fs_col_messages', [{ text: 'secret of A' }]);
    store.setItem('fs_col_messages', JSON.stringify([{ text: 'legacy' }]));
    store.setItem('fs_chat_a_b', '[]');
    store.setItem('theme', 'dark');
    assert.equal(syncChatCacheOwner('userB', store), 3);
    assert.deepEqual(store.keys(), ['theme']);
    chatCache('userB', store).set('fs_col_messages', [{ text: 'B' }]);
    assert.equal(syncChatCacheOwner('userB', store), 0, 'the own cache of B must survive');
    assert.deepEqual(chatCache('userB', store).get('fs_col_messages', []), [{ text: 'B' }]);
  });

  it('logout clears every chat cache and nothing else', () => {
    const store = memory();
    chatCache('userA', store).set('fs_col_messages', [1]);
    chatCache('userB', store).set('fs_col_messages', [2]);
    store.setItem('theme', 'dark');
    clearChatCaches(store);
    assert.deepEqual(store.keys(), ['theme']);
  });
});

describe('message pages share one browser (jsdom)', () => {
  const windows = [];
  after(() => windows.forEach(w => w.close()));
  const tick = (ms = 40) => new Promise((resolve) => setTimeout(resolve, ms));
  const loose = () => new Proxy(function () {}, { get: (_t, k) => (k === 'then' || k === Symbol.toPrimitive ? undefined : loose()), apply: () => loose() });
  const IMPORT = /^\s*import\s+([\w*{}\s,]+?)\s+from\s+["'][^"']+["'];?/gm;

  async function openPage(page, { uid, snapshot }) {
    const html = read(`${page}.html`);
    const body = [...html.matchAll(/<script type="module">([\s\S]*?)<\/script>/g)].map(m => m[1]).find(s => s.includes('chat-cache.js'));
    assert.ok(body, `${page}.html does not use chat-cache.js`);
    const dom = new JSDOM(html.replace(/<script[\s\S]*?<\/script>/g, ''), { url: `http://localhost/${page}.html`, runScripts: 'outside-only', pretendToBeVisual: true });
    const { window } = dom;
    windows.push(window);
    for (const [k, v] of Object.entries(snapshot)) window.localStorage.setItem(k, v);
    const names = [...body.matchAll(IMPORT)].flatMap(m => (/\{([^}]*)\}/.exec(m[1]) || [0, ''])[1].split(',').map(x => x.trim()).filter(Boolean).map(x => x.split(/\s+as\s+/).pop()));
    const stubs = Object.fromEntries(names.map(n => [n, loose()]));
    const ws = window.localStorage;
    Object.assign(stubs, {
      db: {}, auth: { currentUser: uid ? { uid } : null },
      tenantReady: Promise.resolve('org_a'), whereMyOrg: () => ({}), loadIdentity: async () => ({ uid, orgId: 'org_a', role: 'Employee' }),
      onAuthStateChanged: (_a, cb) => { Promise.resolve().then(() => cb(uid ? { uid, displayName: 'U' } : null)); return () => {}; },
      onSnapshot: () => () => {}, getDocs: async () => ({ docs: [], empty: true, forEach() {} }), getDoc: async () => ({ exists: () => false, data: () => ({}) }),
      checkBackendFirebaseStatus: async () => ({ online: true }),
      chatCache: (u) => chatCache(u, ws), syncChatCacheOwner: (u) => syncChatCacheOwner(u, ws), clearChatCaches: () => clearChatCaches(ws), CHAT_CACHE_PREFIX
    });
    window.__stubs = stubs;
    window.lucide = { createIcons: () => {} };
    window.renderLucideIcons = () => {};
    window.escapeHtml = (v) => String(v ?? '');
    window.fetch = async () => ({ ok: false, json: async () => ({}) });
    const code = body.replace(IMPORT, '').replace(/import\(\s*["']\.\/[\w./-]+["']\s*\)/g, 'Promise.resolve(window.__stubs)');
    try { await window.eval(`(async function () { const { ${Object.keys(stubs).join(', ')} } = window.__stubs; ${code} })()`); } catch (_) { /* a page that cannot finish booting still must not leak */ }
    await tick();
    return window;
  }
  const dump = (w) => Object.fromEntries(Object.keys(w.localStorage).map(k => [k, w.localStorage.getItem(k)]));

  for (const page of ['admin-message', 'employee-message']) {
    it(`${page}: user B never sees the cached messages of user A, and logging out clears them`, async () => {
      const store = memory();
      chatCache('userA', store).set('fs_col_messages', [{ id: 'm1', text: 'secret of A', chatId: 'a_b' }]);
      chatCache('userA', store).set('fs_chat_a_b', [{ id: 'm1', text: 'secret of A' }]);
      store.setItem('fs_col_messages', JSON.stringify([{ id: 'old', text: 'legacy secret' }]));
      const snapshot = Object.fromEntries(store.keys().map(k => [k, store.getItem(k)]));

      const asB = await openPage(page, { uid: 'userB', snapshot });
      const left = Object.entries(dump(asB)).map(([k, v]) => `${k}=${v}`).join('\n');
      assert.ok(!left.includes('secret of A') && !left.includes('legacy secret'), `the browser of B still holds: ${left}`);
      assert.ok(!asB.document.body.textContent.includes('secret of A'));

      // B caches a message; then nobody is signed in: no chat cache survives
      chatCache('userB', asB.localStorage).set('fs_col_messages', [{ text: 'B secret' }]);
      const out = await openPage(page, { uid: null, snapshot: dump(asB) });
      assert.ok(!Object.keys(out.localStorage).some(k => k.startsWith(CHAT_CACHE_PREFIX)), 'a chat cache survived sign-out');
    });
  }

  it('the pages no longer touch the un-keyed cache keys directly', () => {
    for (const page of ['admin-message', 'employee-message']) {
      assert.ok(!/localStorage\.(get|set|remove)Item\((?:'fs_col_messages'|`fs_chat_|threadKey)/.test(read(`${page}.html`)), `${page}.html reads or writes the un-keyed cache`);
    }
  });
});
