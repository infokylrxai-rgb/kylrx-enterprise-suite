/**
 * The app had 110 distinct font sizes, padding up to 6rem, and fixed widths of 400-500px
 * in a hundred places. That is what made it feel out of scale: every screen was sized by
 * hand, nothing agreed, and some blocks were simply too large.
 *
 * It is now one type scale of ten steps, spacing capped at 2rem, and no fixed width wide
 * enough to overflow a narrow window. These tests fail if that drifts back, because it
 * drifts one hand-written style attribute at a time.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pages = fs.readdirSync(ROOT).filter(f => /\.html$/.test(f));
// The stylesheets share the scale. style-landing.css is excluded: it is the marketing
// page, where large display type is the point rather than an accident.
const sheets = fs.readdirSync(ROOT).filter(f => /\.css$/.test(f) && f !== 'style-landing.css');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');

const TYPE_SCALE = new Set(['0.7', '0.75', '0.8', '0.875', '1', '1.125', '1.25', '1.5', '1.875', '2.25']);
const MAX_SPACE = 2;

function collect(re, group = 1) {
  const found = new Map();                       // value -> [files]
  for (const f of pages) {
    for (const m of read(f).matchAll(re)) {
      const v = m[group];
      if (!found.has(v)) found.set(v, []);
      if (!found.get(v).includes(f)) found.get(v).push(f);
    }
  }
  return found;
}

describe('one type scale', () => {
  it('every font size is a step on the scale', () => {
    const sizes = collect(/font-size:\s*([0-9.]+)rem/g);
    const off = [...sizes.keys()].filter(v => !TYPE_SCALE.has(v));
    assert.deepEqual(off, [], 'these sizes are not on the scale: ' +
      off.map(v => v + 'rem (' + sizes.get(v).slice(0, 2).join(', ') + ')').join('; '));
  });

  it('stays within ten steps', () => {
    const sizes = collect(/font-size:\s*([0-9.]+)rem/g);
    assert.ok(sizes.size <= 10, 'grew back to ' + sizes.size + ' distinct sizes');
  });

  it('nothing is larger than 2.25rem', () => {
    const sizes = collect(/font-size:\s*([0-9.]+)rem/g);
    const big = [...sizes.keys()].filter(v => parseFloat(v) > 2.25);
    assert.deepEqual(big, [], 'oversized text: ' + big.join(', '));
  });
});

describe('the stylesheets share the scale', () => {
  it('no stylesheet sets a size off the scale', () => {
    const off = [];
    for (const f of sheets) {
      for (const m of fs.readFileSync(path.join(ROOT, f), 'utf8').matchAll(/font-size:s*([0-9.]+)rem/g)) {
        if (!TYPE_SCALE.has(m[1])) off.push(f + ': ' + m[1] + 'rem');
      }
    }
    assert.deepEqual(off, [], 'off-scale sizes in stylesheets: ' + off.join(', '));
  });
});

describe('spacing is capped', () => {
  it('no padding or margin exceeds 2rem', () => {
    const offenders = [];
    for (const f of pages) {
      for (const m of read(f).matchAll(/(padding|margin)[a-z-]*:\s*([^;"']*rem[^;"']*)/g)) {
        for (const v of m[2].matchAll(/([0-9.]+)rem/g)) {
          if (parseFloat(v[1]) > MAX_SPACE) offenders.push(f + ': ' + m[0].trim());
        }
      }
    }
    assert.deepEqual(offenders.slice(0, 8), [], 'spacing above 2rem: ' + offenders.slice(0, 8).join(' | '));
  });
});

describe('nothing is pinned wider than the window', () => {
  /**
   * A fixed width wider than a phone forces a horizontal scrollbar and pushes content
   * off the side. The intent - "about this wide" - is kept as a maximum instead.
   */
  it('no fixed width of 320px or more', () => {
    const offenders = [];
    for (const f of pages) {
      for (const m of read(f).matchAll(/(^|[;"\s])width:\s*(\d{3,4})px/g)) {
        if (Number(m[2]) >= 320) offenders.push(f + ': width: ' + m[2] + 'px');
      }
    }
    assert.deepEqual(offenders.slice(0, 8), [], 'fixed widths that will overflow: ' + offenders.slice(0, 8).join(' | '));
  });

  /**
   * "width: 620px; max-width: 95vw" means 620 wide, never more than 95vw. Rewriting the
   * width alone left two max-widths and the later one won, so the element became WIDER.
   * Both caps have to be expressed together.
   */
  it('never leaves two max-widths competing', () => {
    const offenders = pages.filter(f => /max-width:\s*\d+px;?\s*max-width:/.test(read(f)));
    assert.deepEqual(offenders, [], 'the second max-width silently wins in: ' + offenders.join(', '));
  });
});
