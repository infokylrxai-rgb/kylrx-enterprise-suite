/**
 * A light and dark theme the person chooses, remembered between visits, with a hint of
 * glass on the surfaces that frame the page.
 *
 * The constraint shaping all of this: about 1,170 colours are written inline in the
 * markup, and an inline style beats a stylesheet. Two thirds already go through tokens,
 * so redefining those does most of the work; the common inline values are overridden
 * explicitly for dark mode.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const css = fs.readFileSync(path.join(ROOT, 'kylrx-theme.css'), 'utf8');
const js = fs.readFileSync(path.join(ROOT, 'kylrx-theme.js'), 'utf8');
const pages = fs.readdirSync(ROOT).filter(f => /\.html$/.test(f));

describe('the theme reaches every page', () => {
  it('every page loads the stylesheet and the script', () => {
    const missing = pages.filter(f => {
      const s = fs.readFileSync(path.join(ROOT, f), 'utf8');
      return /<\/head>/i.test(s) && !(s.includes('kylrx-theme.css') && s.includes('kylrx-theme.js'));
    });
    assert.deepEqual(missing, [], 'these pages have no theme: ' + missing.join(', '));
  });

  /**
   * The stylesheet has to come after the page's own, or the tokens it redefines are
   * overwritten by the originals and the theme simply does not apply.
   */
  it('loads after the page\'s own stylesheets', () => {
    for (const f of ['admin-dashboard.html', 'admin-role-management.html']) {
      const s = fs.readFileSync(path.join(ROOT, f), 'utf8');
      const ours = s.indexOf('kylrx-theme.css');
      const others = [...s.matchAll(/<link rel="stylesheet" href="(?!kylrx-theme)/g)].map(m => m.index);
      if (others.length) assert.ok(ours > Math.max(...others), f + ': the theme must load last');
    }
  });
});

describe('both themes are defined', () => {
  it('defines a light and a dark palette', () => {
    assert.match(css, /\[data-theme="dark"\]/);
    assert.match(css, /--text-main:\s*#16162b/, 'light text colour');
    assert.match(css, /--bg:\s*#0d0f1a/, 'dark background');
  });

  it('tells the browser which scheme is in use, so its own controls match', () => {
    assert.match(css, /color-scheme: light/);
    assert.match(css, /color-scheme: dark/);
  });

  it('keeps glass to the framing surfaces, not to cards carrying text', () => {
    assert.match(css, /\.sidebar,[\s\S]{0,80}backdrop-filter/);
    const cardRule = css.match(/\.card, \.stat-card[^}]*}/);
    assert.ok(cardRule && !/backdrop-filter/.test(cardRule[0]),
      'text on blurred glass is harder to read for no benefit');
  });

  it('respects a request for reduced motion', () => {
    assert.match(css, /prefers-reduced-motion/);
  });
});

describe('choosing a theme', () => {
  it('offers light, dark and following the device', () => {
    for (const choice of ['light', 'dark', 'system']) {
      assert.ok(js.includes(`data-choice="${choice}"`), `missing the ${choice} option`);
    }
  });

  it('remembers the choice', () => {
    assert.match(js, /localStorage\.setItem\(STORAGE_KEY/);
    assert.match(js, /localStorage\.getItem\(STORAGE_KEY\)/);
  });

  /** Applying the theme after paint means a white flash on every navigation. */
  it('applies the theme before the page paints', () => {
    const applyAt = js.indexOf('apply(stored());');
    const domReady = js.indexOf('DOMContentLoaded');
    assert.ok(applyAt > -1 && applyAt < domReady, 'the theme must be set before the DOM is ready');
  });

  it('keeps following the device when the device changes', () => {
    assert.match(js, /addEventListener\('change'/);
  });

  it('survives storage being unavailable', () => {
    // Private windows and blocked site data throw on access rather than returning null.
    assert.ok((js.match(/catch \(_\)/g) || []).length >= 3, 'every storage access needs a guard');
  });
});

describe('the sidebar can be folded down', () => {
  it('groups collapse and the choice is remembered', () => {
    assert.match(js, /NAV_KEY/);
    assert.match(js, /nav-label/);
  });

  it('never folds away the group holding the current page', () => {
    assert.match(js, /holdsActive/, 'folding the active group loses the person their place');
  });

  it('is reachable from the keyboard', () => {
    assert.match(js, /keydown/);
    assert.match(js, /tabindex/);
  });
});
