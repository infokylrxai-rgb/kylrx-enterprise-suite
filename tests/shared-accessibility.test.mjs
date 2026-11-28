/**
 * What every page gets from kylrx-theme-init.js: its portal marked, a skip link, the
 * sidebar named as navigation, and icon-only buttons given an accessible name.
 * The script is run in a simulated page, not read.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const INIT = fs.readFileSync(path.join(ROOT, 'kylrx-theme-init.js'), 'utf8');
const CSS = fs.readFileSync(path.join(ROOT, 'kylrx-theme.css'), 'utf8');

function el(tag, props = {}) {
  const e = {
    tagName: tag.toUpperCase(), attrs: {}, children: [], textContent: '', id: '', style: {},
    setAttribute(k, v) { this.attrs[k] = String(v); if (k === 'id') this.id = v; },
    getAttribute(k) { return k in this.attrs ? this.attrs[k] : null; },
    hasAttribute(k) { return k in this.attrs; },
    appendChild(c) { this.children.push(c); return c; },
    insertBefore(c) { this.children.unshift(c); return c; },
    addEventListener() {},
    querySelector(sel) { return this.children.find(c => matches(c, sel)) || null; },
    querySelectorAll(sel) { return all(this).filter(c => matches(c, sel)); },
    ...props
  };
  return e;
}
const all = (n) => n.children.flatMap(c => [c, ...all(c)]);
function matches(e, sel) {
  return sel.split(',').map(s => s.trim()).some(s =>
    s === e.tagName.toLowerCase() ||
    (s.startsWith('.') && (e.className || '').split(' ').includes(s.slice(1))) ||
    (s === 'a[href]' && e.tagName === 'A' && e.getAttribute('href') !== null) ||
    (s === '[data-lucide]' && e.getAttribute('data-lucide') !== null) ||
    (s === '[role="button"]' && e.getAttribute('role') === 'button') ||
    (s === '[role="main"]' && e.getAttribute('role') === 'main'));
}

function boot(file) {
  const attrs = {};
  const body = el('body');
  const aside = el('aside', { className: 'sidebar' });
  const main = el('main');
  const iconBtn = el('button'); const icon = el('i'); icon.setAttribute('data-lucide', 'trash-2'); iconBtn.appendChild(icon);
  const titled = el('button'); titled.setAttribute('title', 'Download report');
  const texted = el('button', { textContent: 'Save' });
  main.appendChild(iconBtn); main.appendChild(titled); main.appendChild(texted);
  body.appendChild(aside); body.appendChild(main);
  const document = {
    readyState: 'complete',
    documentElement: { setAttribute: (k, v) => { attrs[k] = v; }, getAttribute: (k) => attrs[k] },
    body,
    createElement: (t) => el(t),
    getElementById: (id) => all(body).find(c => c.id === id) || null,
    querySelector: (sel) => all(body).find(c => matches(c, sel)) || null,
    querySelectorAll: (sel) => all(body).filter(c => matches(c, sel)),
    addEventListener() {}
  };
  const window = { addEventListener() {}, dispatchEvent() {} };
  window.window = window;
  vm.runInNewContext(INIT, {
    window, document, location: { pathname: '/kylrx/' + file },
    localStorage: { getItem: () => null, setItem() {} },
    CustomEvent: class {}, getComputedStyle: () => ({ getPropertyValue: () => '' }), console
  });
  return { attrs, body, aside, main, iconBtn, titled, texted };
}

describe('each portal is marked', () => {
  for (const [file, portal] of [['admin-dashboard.html', 'admin'], ['manager-dashboard.html', 'manager'],
    ['employee-dashboard.html', 'employee'], ['hrms-dashboard.html', 'hr'], ['login.html', 'public'], ['employee-login.html', 'public']]) {
    it(file + ' is ' + portal, () => assert.equal(boot(file).attrs['data-portal'], portal));
  }
  it('and each marker has its own colour', () => {
    for (const p of ['manager', 'employee', 'hr']) assert.match(CSS, new RegExp('\\[data-portal="' + p + '"\\]\\s*\\{ --k-portal:'));
  });
  it('the sidebar says which portal it is', () => {
    const p = boot('manager-dashboard.html');
    assert.equal(p.aside.children[0].textContent, 'Manager portal');
  });
});

describe('keyboard and screen readers', () => {
  it('a skip link leads to the main content', () => {
    const p = boot('admin-dashboard.html');
    const skip = p.body.children[0];
    assert.equal(skip.textContent, 'Skip to main content');
    assert.equal(skip.href, '#' + p.main.id);
    assert.equal(p.main.getAttribute('tabindex'), '-1');
  });
  it('the sidebar is named as navigation', () => {
    const p = boot('admin-dashboard.html');
    assert.equal(p.aside.getAttribute('aria-label'), 'Main navigation');
    assert.equal(p.aside.getAttribute('role'), 'navigation');
  });
  it('icon-only buttons get a name; buttons with text are left alone', () => {
    const p = boot('admin-dashboard.html');
    assert.equal(p.iconBtn.getAttribute('aria-label'), 'Trash 2');
    assert.equal(p.titled.getAttribute('aria-label'), 'Download report');
    assert.equal(p.texted.getAttribute('aria-label'), null);
  });
});

describe('small screens and touch', () => {
  it('wide tables scroll inside themselves on a narrow screen', () => {
    assert.match(CSS, /@media \(max-width: 760px\) \{\s*table \{ display: block; max-width: 100%; overflow-x: auto;/);
  });
  it('touch targets are at least 44px on a touch screen', () => {
    assert.match(CSS, /@media \(pointer: coarse\) \{\s*button, \.btn, \[role="button"\], a\.btn, select \{ min-height: 44px; \}/);
  });
});
