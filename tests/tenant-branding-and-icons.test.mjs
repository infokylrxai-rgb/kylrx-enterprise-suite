/**
 * Two things a customer's employees see.
 *
 * 1. Whose name is on a payout notice. Kylrx is the software; the employer is the
 *    customer. Bank-transfer notices were signed "Kylrx AI Team" and sent from the
 *    "Kylrx AI finance gateway", so an employee of another company received a message
 *    about their salary from a vendor they have never heard of - which reads as a
 *    phishing attempt.
 *
 * 2. Whether icons appear at all. Lucide converts <i data-lucide> only when
 *    createIcons() runs, and this app builds screens with innerHTML in 526 places that
 *    contain an icon. A missed call leaves an empty gap and says nothing in the console.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
const pages = fs.readdirSync(ROOT).filter(f => /\.html$/.test(f));

describe('messages to employees carry the employer\'s name', () => {
  const transfer = read('admin-bank-transfer.html');

  it('no payout message is signed by the vendor', () => {
    const body = transfer.replace(/\/\*[\s\S]*?\*\//g, '');     // the comment explains the history
    for (const phrase of ['Kylrx AI Team', 'Kylrx AI finance gateway', 'Kylrx AI - Payout']) {
      assert.ok(!body.includes(phrase), 'still signed by the vendor: ' + phrase);
    }
  });

  it('uses the organisation\'s own name', () => {
    assert.match(transfer, /signerName\(\)/);
    assert.match(transfer, /organizations/, 'the name should come from the org document');
  });

  it('falls back to something neutral, never to the vendor', () => {
    assert.match(transfer, /'your organisation'/);
  });

  it('automated footers do not name the vendor to an employee', () => {
    for (const f of ['admin-app.js', 'pms-service.js']) {
      const s = read(f);
      assert.ok(!/Kylrx\.ai (Super Admin Console|Enterprise PMS)/.test(s),
        f + ' still names the vendor in an email footer');
    }
  });
});

describe('icons render wherever markup is inserted', () => {
  it('every page with icons loads the observer', () => {
    const missing = pages.filter(f => {
      const s = read(f);
      return s.includes('data-lucide') && /<\/body>/i.test(s) && !s.includes('kylrx-icons.js');
    });
    assert.deepEqual(missing, [], 'icons may not appear on: ' + missing.join(', '));
  });

  it('converts what is already present, then watches for more', () => {
    const js = read('kylrx-icons.js');
    assert.match(js, /MutationObserver/);
    assert.match(js, /createIcons/);
  });

  it('batches conversions rather than running per inserted node', () => {
    // A list appending fifty rows should convert once, not fifty times.
    assert.match(read('kylrx-icons.js'), /requestAnimationFrame/);
  });

  it('does nothing harmful when the library is absent', () => {
    const js = read('kylrx-icons.js');
    assert.match(js, /if \(!window\.lucide/);
    assert.match(js, /catch \(_\)/);
  });

  it('every icon name used actually exists in the bundle', () => {
    const lib = read('lucide.min.js');
    const pascal = (k) => k.split('-').map(p => p.charAt(0).toUpperCase() + p.slice(1)).join('');
    const names = new Set();
    for (const f of fs.readdirSync(ROOT).filter(x => /\.(html|js)$/.test(x))) {
      for (const m of read(f).matchAll(/data-lucide="([a-zA-Z0-9-]+)"/g)) names.add(m[1]);
    }
    const unknown = [...names].filter(n => !new RegExp('\\b' + pascal(n) + '\\b').test(lib));
    assert.deepEqual(unknown, [], 'these icon names render nothing: ' + unknown.join(', '));
  });
});
