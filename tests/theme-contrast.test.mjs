/**
 * Checks every text-on-background pairing the theme defines, in both themes, against
 * WCAG 2.2 AA. The tokens are read from kylrx-theme.css itself, so this fails the moment
 * a colour is changed to something unreadable.
 *
 *   text on its background     4.5:1   (1.4.3)
 *   form-control boundaries    3:1     (1.4.11 - the edge is how you find the control)
 *
 * Decorative card borders and dividers are deliberately exempt: 1.4.11 covers boundaries
 * needed to identify a component, and the brief asks for these to be subtle.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const css = fs.readFileSync(path.join(ROOT, 'kylrx-theme.css'), 'utf8');

function tokens(selector) {
  const start = css.indexOf(selector + ' {');
  assert.ok(start > -1, 'no block for ' + selector);
  const body = css.slice(start, css.indexOf('}', start));
  const out = {};
  for (const m of body.matchAll(/--(k-[a-z0-9-]+):\s*(#[0-9a-fA-F]{6})/g)) out[m[1]] = m[2];
  return out;
}

const lum = (hex) => {
  const c = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map(v => v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4));
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
};
const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };

// [foreground, background, minimum] - each is a pairing the app actually renders.
const PAIRS = [
  ['k-text', 'k-bg', 4.5], ['k-text', 'k-surface', 4.5], ['k-text', 'k-elevated', 4.5], ['k-text', 'k-subtle', 4.5],
  ['k-text-2', 'k-surface', 4.5], ['k-text-2', 'k-bg', 4.5],
  ['k-muted', 'k-surface', 4.5], ['k-muted', 'k-bg', 4.5], ['k-muted', 'k-elevated', 4.5], ['k-muted', 'k-subtle', 4.5],
  ['k-accent-text', 'k-surface', 4.5], ['k-accent-text', 'k-bg', 4.5], ['k-accent-text', 'k-accent-soft', 4.5],
  ['k-on-accent', 'k-accent', 4.5],
  ['k-success-text', 'k-surface', 4.5], ['k-success-text', 'k-success-soft', 4.5], ['k-on-success', 'k-success', 4.5],
  ['k-danger-text', 'k-surface', 4.5], ['k-danger-text', 'k-danger-soft', 4.5], ['k-on-danger', 'k-danger', 4.5],
  ['k-warning-text', 'k-surface', 4.5], ['k-warning-text', 'k-warning-soft', 4.5], ['k-on-warning', 'k-warning', 4.5],
  ['k-info-text', 'k-surface', 4.5], ['k-info-text', 'k-info-soft', 4.5], ['k-on-info', 'k-info', 4.5],
  ['k-border-strong', 'k-surface', 3]
];

for (const theme of ['dark', 'light']) {
  describe(theme + ' theme meets WCAG 2.2 AA', () => {
    const t = tokens('[data-theme="' + theme + '"]');

    it('defines every token the pairings need', () => {
      const missing = [...new Set(PAIRS.flatMap(([a, b]) => [a, b]))].filter(k => !t[k]);
      assert.deepEqual(missing, []);
    });

    for (const [fg, bg, min] of PAIRS) {
      it(fg + ' on ' + bg + ' >= ' + min + ':1', () => {
        const r = ratio(t[fg], t[bg]);
        assert.ok(r >= min, t[fg] + ' on ' + t[bg] + ' is ' + r.toFixed(2) + ':1');
      });
    }
  });
}

describe('the brief\'s palette is used as given', () => {
  it('dark', () => {
    const t = tokens('[data-theme="dark"]');
    assert.deepEqual(
      [t['k-bg'], t['k-sidebar'], t['k-surface'], t['k-elevated'], t['k-border'], t['k-text'], t['k-muted'], t['k-accent']],
      ['#111214', '#17191B', '#1C1E20', '#25282A', '#303235', '#F2F2F2', '#92969B', '#D5E45C']);
  });
  it('light', () => {
    const t = tokens('[data-theme="light"]');
    assert.deepEqual(
      [t['k-bg'], t['k-sidebar'], t['k-surface'], t['k-elevated'], t['k-border'], t['k-text'], t['k-muted'], t['k-accent']],
      ['#F4F5F3', '#ECEEEC', '#FFFFFF', '#FFFFFF', '#E2E5E1', '#202326', '#686D70', '#A5B52E']);
  });
});
