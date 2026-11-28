/**
 * A button that nothing handles is the quietest bug there is: it renders, it looks
 * clickable, and clicking it does nothing at all - no error, nothing in the console.
 *
 * An earlier rough count put these at 53. Counting properly - a button is dead only if
 * its id appears in no script anywhere in the app, it has no inline handler, and it does
 * not submit a form - there were 8. All 8 were one thing: a "Google Sign-In Simulation"
 * modal on the four login pages, with an email box and a Proceed button. Nothing opened
 * it and neither button was wired. It has been removed rather than wired, because wiring
 * Proceed would have let anyone type any address and be treated as signed in.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SKIP = new Set(['node_modules', '.git', 'netlify_site', 'tests']);

function walk(dir, acc = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (SKIP.has(e.name)) continue;
    const f = path.join(dir, e.name);
    if (e.isDirectory()) walk(f, acc); else acc.push(f);
  }
  return acc;
}

const files = walk(ROOT);
const pages = files.filter(f => f.endsWith('.html'));
let allScript = files.filter(f => /\.(js|mjs)$/.test(f)).map(f => fs.readFileSync(f, 'utf8')).join('\n');
for (const p of pages) {
  allScript += '\n' + (fs.readFileSync(p, 'utf8').match(/<script[\s\S]*?<\/script>/g) || []).join('\n');
}

describe('every button does something', () => {
  it('scans the whole app', () => {
    assert.ok(pages.length >= 80, 'only ' + pages.length + ' pages found');
  });

  it('no button with an id is left without a handler', () => {
    const dead = [];
    for (const p of pages) {
      const html = fs.readFileSync(p, 'utf8');
      for (const m of html.matchAll(/<button\b([^>]*)>([\s\S]*?)<\/button>/g)) {
        const attrs = m[1];
        const id = (attrs.match(/\bid="([^"]+)"/) || [])[1];
        if (!id) continue;
        if (/\bonclick=/.test(attrs)) continue;
        if (/\btype="submit"/.test(attrs)) continue;
        if (/\bdata-(close|bs-dismiss|dismiss|tab|target|action)=/.test(attrs)) continue;
        const wired = allScript.includes("'" + id + "'") || allScript.includes('"' + id + '"') || allScript.includes('#' + id);
        if (!wired) dead.push(path.basename(p) + ' #' + id);
      }
    }
    assert.deepEqual(dead, [], 'buttons that do nothing when clicked: ' + dead.join(', '));
  });

  it('the simulated Google sign-in is gone from every login page', () => {
    for (const f of ['login.html', 'employee-login.html', 'hrms-login.html', 'manager-login.html']) {
      const s = fs.readFileSync(path.join(ROOT, f), 'utf8');
      assert.ok(!s.includes('id="fallbackModalOverlay"'), f + ' still has the simulation modal');
      assert.ok(!/simulate Google Authenticat/i.test(s.replace(/<!--[\s\S]*?-->/g, '')),
        f + ' still offers to simulate Google sign-in');
    }
  });
});
