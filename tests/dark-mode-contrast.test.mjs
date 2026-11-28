/**
 * Dark mode has to be readable, measured rather than assumed.
 *
 * Document Templates in the dark theme showed light text on light cards: the page
 * defined its own colour variables (--bg-card: #ffffff, --text-secondary: #475569) that
 * the theme never re-pointed, the shared sidebar forced #475569 link text (a CSS comment
 * hid the declaration from the colour pass), and white text sat on the lime fill.
 *
 * The static check stops a page reintroducing un-themed grey variables. The rendered
 * check opens real pages in headless Chrome (tools/contrast-audit.js, offline, with
 * Firebase and the API stubbed) and measures every visible text against what is
 * actually behind it.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

describe('every grey a page defines follows the theme', () => {
  it('no page or stylesheet defines a surface, text or border variable the theme does not re-point', () => {
    const theme = fs.readFileSync(path.join(ROOT, 'kylrx-theme.css'), 'utf8');
    const aliased = new Set([...theme.matchAll(/(--[a-z0-9-]+)\s*:/g)].map(m => m[1]));
    const missing = new Set();
    for (const f of fs.readdirSync(ROOT).filter(x => /\.(html|css)$/.test(x) && x !== 'kylrx-theme.css')) {
      const s = fs.readFileSync(path.join(ROOT, f), 'utf8');
      for (const m of s.matchAll(/(--[a-z0-9-]+)\s*:\s*(#[0-9a-fA-F]{6}|#[0-9a-fA-F]{3}|white)\s*[;}]/g)) {
        if (aliased.has(m[1])) continue;
        let x = m[2].toLowerCase(); if (x === 'white') x = '#ffffff';
        if (x.length === 4) x = '#' + [...x.slice(1)].map(c => c + c).join('');
        const r = parseInt(x.slice(1, 3), 16), g = parseInt(x.slice(3, 5), 16), b = parseInt(x.slice(5, 7), 16);
        if (Math.max(r, g, b) - Math.min(r, g, b) > 40) continue;      // a hue (category colour), not a surface
        missing.add(m[1] + ' (' + f + ')');
      }
    }
    assert.deepEqual([...missing], [], 'add these to the alias block in kylrx-theme.css');
  });
});

describe('rendered pages pass contrast in both themes', { timeout: 300000 }, () => {
  const run = (page, theme) => {
    try {
      return { code: 0, out: execFileSync(process.execPath, [path.join(ROOT, 'tools', 'contrast-audit.js'), page, theme],
        { cwd: ROOT, env: { ...process.env, CONTRAST_SHOT_DIR: fs.mkdtempSync(path.join(ROOT, '.contrast-')) }, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }) };
    } catch (err) { return { code: err.status, out: String(err.stdout || '') + String(err.stderr || '') }; }
  };
  for (const [page, theme] of [['admin-document-templates.html', 'dark'], ['admin-document-templates.html', 'light'], ['login.html', 'dark']]) {
    it(`${page} in the ${theme} theme`, () => {
      const r = run(page, theme);
      const summary = r.out.split('\n').filter(l => /below AA| x rgb/.test(l)).join('\n');
      assert.equal(r.code, 0, summary || r.out.slice(-600));
      assert.match(summary, /0 below AA/);
    });
  }
  it('cleans up', () => {
    for (const d of fs.readdirSync(ROOT).filter(x => x.startsWith('.contrast-'))) fs.rmSync(path.join(ROOT, d), { recursive: true, force: true });
  });
});
