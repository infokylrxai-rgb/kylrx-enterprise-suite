/**
 * The dark/light theme system (overhaul Part 3).
 *
 * kylrx-theme-init.js is executed here in a simulated page - not read - so these assert
 * what it does: dark by default, the choice remembered, the theme set synchronously as
 * the script runs (before any paint), the switch working, and charts recoloured.
 *
 * The earlier theme attempt layered a stylesheet over ~13,000 hard-coded colours that a
 * stylesheet cannot override, so dark mode only partly applied. Those colours are now
 * tokens; the checks at the end make sure they stay that way, and that no email - which
 * Gmail and Outlook render without our stylesheet - was given a token.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const INIT = fs.readFileSync(path.join(ROOT, 'kylrx-theme-init.js'), 'utf8');
const pages = fs.readdirSync(ROOT).filter(f => f.endsWith('.html'));

/** Run the initialiser in a fresh simulated page and hand back what it did. */
function boot({ stored = null, storageThrows = false, topbar = false, chart = null } = {}) {
  const attrs = {};
  const store = new Map(stored ? [['kylrx_theme', stored]] : []);
  const listeners = {};
  const appended = [];
  const makeEl = () => ({
    style: {}, attrs: {}, listeners: {}, textContent: '', title: '',
    setAttribute(k, v) { this.attrs[k] = v; }, getAttribute(k) { return this.attrs[k]; },
    addEventListener(t, fn) { this.listeners[t] = fn; }, appendChild(c) { appended.push(c); }
  });
  const bar = topbar ? makeEl() : null;
  let toggle = null;
  const document = {
    readyState: 'complete',
    documentElement: {
      setAttribute: (k, v) => { attrs[k] = v; },
      getAttribute: (k) => attrs[k]
    },
    body: { appendChild: (c) => appended.push(c) },
    createElement: () => (toggle = makeEl()),
    getElementById: (id) => (id === 'kylrxThemeToggle' ? toggle : null),
    querySelector: () => bar,
    addEventListener() {}
  };
  const localStorage = {
    getItem: (k) => { if (storageThrows) throw new Error('blocked'); return store.has(k) ? store.get(k) : null; },
    setItem: (k, v) => { if (storageThrows) throw new Error('blocked'); store.set(k, v); }
  };
  const window = {
    addEventListener: (t, fn) => { listeners[t] = fn; },
    dispatchEvent: (e) => { if (listeners[e.type]) listeners[e.type](e); },
    Chart: chart
  };
  const ctx = {
    window, document, localStorage,
    CustomEvent: class { constructor(type, init) { this.type = type; this.detail = init && init.detail; } },
    getComputedStyle: () => ({ getPropertyValue: (n) => (n === '--k-muted' ? (attrs['data-theme'] === 'light' ? '#686D70' : '#92969B') : '') })
  };
  ctx.window.window = ctx.window;
  // what the theme is the instant the script finishes, before any later callback
  vm.runInNewContext(INIT, ctx);
  return { theme: () => attrs['data-theme'], store, toggle: () => toggle, bar, appended, window, listeners };
}

describe('choosing a theme', () => {
  it('a first visit is dark', () => {
    assert.equal(boot().theme(), 'dark');
  });

  it('a returning light-theme visitor gets light, set synchronously before paint', () => {
    assert.equal(boot({ stored: 'light' }).theme(), 'light');
  });

  it('a stored value that is not a theme falls back to dark', () => {
    assert.equal(boot({ stored: 'purple' }).theme(), 'dark');
  });

  it('the switch flips the theme and remembers it', () => {
    const p = boot();
    p.toggle().listeners.click();
    assert.equal(p.theme(), 'light');
    assert.equal(p.store.get('kylrx_theme'), 'light');
    p.toggle().listeners.click();
    assert.equal(p.theme(), 'dark');
    assert.equal(p.store.get('kylrx_theme'), 'dark');
  });

  it('the switch says what it will do, for screen readers', () => {
    const p = boot();
    assert.equal(p.toggle().attrs['aria-label'], 'Switch to light theme');
    p.toggle().listeners.click();
    assert.equal(p.toggle().attrs['aria-label'], 'Switch to dark theme');
  });

  it('blocked storage still gives a working dark page', () => {
    const p = boot({ storageThrows: true });
    assert.equal(p.theme(), 'dark');
    p.toggle().listeners.click();                       // must not throw
    assert.equal(p.theme(), 'light');
  });

  it('the switch sits in the top bar when the page has one', () => {
    const p = boot({ topbar: true });
    assert.ok(p.appended.includes(p.toggle()));
    assert.notEqual(p.toggle().style.position, 'fixed');
  });
});

describe('charts follow the theme', () => {
  it('axis text takes the theme colour and live charts redraw on a switch', () => {
    let redraws = 0;
    const chart = { defaults: { color: '#666', borderColor: '#000' }, instances: { a: { update: () => redraws++ } } };
    const p = boot({ chart });
    p.listeners.load();
    assert.equal(chart.defaults.color, '#92969B', 'dark theme muted');
    p.toggle().listeners.click();
    assert.equal(chart.defaults.color, '#686D70', 'light theme muted');
    assert.ok(redraws >= 2, 'live charts redraw');
  });

  it('no chart grid is hard-coded near-white', () => {
    for (const f of fs.readdirSync(ROOT).filter(x => /\.(js|html)$/.test(x))) {
      const s = fs.readFileSync(path.join(ROOT, f), 'utf8');
      assert.ok(!/(grid|ticks)\s*:\s*\{[^}]{0,80}color\s*:\s*'#(f1f5f9|f8fafc)'/.test(s), f + ' has a white chart grid');
    }
  });
});

describe('every page carries the theme, in the right order', () => {
  it('the initialiser is the first thing in <head>', () => {
    const wrong = pages.filter(f => {
      const s = fs.readFileSync(path.join(ROOT, f), 'utf8');
      const head = s.slice(s.search(/<head[^>]*>/i));
      return !/^<head[^>]*>\s*<script src="kylrx-theme-init\.js"><\/script>/i.test(head);
    });
    assert.deepEqual(wrong, [], 'the theme would flash on: ' + wrong.join(', '));
  });

  it('the token stylesheet is the last stylesheet in <head>', () => {
    const wrong = pages.filter(f => {
      const s = fs.readFileSync(path.join(ROOT, f), 'utf8');
      const head = s.slice(0, s.search(/<\/head>/i));
      const links = [...head.matchAll(/<link rel="stylesheet" href="([^"]+)"/g)].map(m => m[1]);
      return links[links.length - 1] !== 'kylrx-theme.css';
    });
    assert.deepEqual(wrong, [], 'page variables would override the tokens on: ' + wrong.join(', '));
  });
});

describe('the hard-coded colours are gone', () => {
  it('the colours that defined the old look are no longer set inline', () => {
    // The slate text, white surface and blue accent were 3,000+ of the 13,206 uses.
    // A #0f172a BACKGROUND is a deliberate dark panel (terminal, toast, dark button) that
    // stays dark in both themes, so its own text is left as it was too. What must not
    // remain is the old text colour on an ordinary surface, or the old blue accent.
    const left = [];
    for (const f of pages) {
      const s = fs.readFileSync(path.join(ROOT, f), 'utf8');
      for (const m of s.matchAll(/style="[^"]*"/g)) {
        const darkPanel = /background(-color)?:\s*#0f172a\b/.test(m[0]);
        if (!darkPanel && /(?:^|[;"\s])color:\s*#(0f172a|64748b)\b/.test(m[0])) left.push(f);
        if (/(?:^|[;"\s])(color|background):\s*#2563eb\b/.test(m[0])) left.push(f);
      }
    }
    assert.deepEqual(left, [], 'old text or accent colours remain inline in: ' + left.join(', '));
  });
});

describe('no white panel is left in the dark theme', () => {
  /*
   * The first tokeniser pass converted hex colours in the top-level folder only. Named
   * "white", the consoles in services/ and public/js/, and style strings built in script
   * were all missed - and next to theme text, a white panel in the dark theme is light
   * text on white. What may stay white is listed here, each for a reason.
   */
  const ALLOWED = {
    'admin-app.js': 'welcome email',
    'controllers/adminController.js': 'emails',
    'routes/email.js': 'emails',
    'pms-service.js': 'email',
    'recruitment-service.js': 'email',
    'onboarding-invite.html': 'invite email',
    'send_live_test.js': 'test mailer',
    'test_email_nandan.js': 'test mailer',
    'trigger_manager_email.js': 'test mailer',
    'gratuityDetailsService.js': 'printable Form I',
    'employee-dashboard.html': 'chat bubble with its own dark text',
    'firebase-config.js': 'Retry button on the amber notice, with its own dark text'
  };
  it('only emails, documents and self-coloured elements keep a literal white background', () => {
    const dirs = ['.', 'services', 'public/js', 'controllers', 'routes'];
    const found = new Set();
    for (const d of dirs) {
      for (const f of fs.readdirSync(path.join(ROOT, d)).filter(x => /\.(js|html|css)$/.test(x) && !/^lucide|style-landing/.test(x))) {
        const rel = d === '.' ? f : d + '/' + f;
        const s = fs.readFileSync(path.join(ROOT, rel), 'utf8');
        for (const m of s.matchAll(/background(-color)?\s*:\s*(white|#fff\b|#ffffff\b)[^;"'`]*/g)) {
          if (!/gradient/.test(m[0])) found.add(rel);
        }
      }
    }
    const unexpected = [...found].filter(f => !ALLOWED[f]);
    assert.deepEqual(unexpected, [], 'white panels that will be unreadable in the dark theme');
  });
});

describe('emails are never themed', () => {
  /** Gmail and Outlook never receive our stylesheet; a token there means no colour. */
  it('no email template contains a theme token', () => {
    const RES = [
      /\bhtml\s*[:=]\s*(`[\s\S]*?`|'[^'\n]*'|"[^"\n]*")/g,
      /(emailHtml|htmlBody|mailHtml|emailBody|bodyHtml|htmlContent)\s*=\s*(`[\s\S]*?`)/g
    ];
    // A string called html is an email only when it is sent: a subject, a recipient or a
    // send call close by. In-app markup built as `let html = ...` is themed on purpose.
    const EMAILISH = /\bsubject\s*:|\bto\s*:\s*[\w.'"`]|sendEmail|sendMail|\/api\/(send-)?email|nodemailer|resend\.|mail(er)?\.send|emailPayload|mailOptions/i;
    const bad = [];
    for (const d of ['.', 'services', 'public/js', 'controllers', 'routes']) {
      for (const f of fs.readdirSync(path.join(ROOT, d)).filter(x => /\.(js|html)$/.test(x))) {
        const rel = d === '.' ? f : d + '/' + f;
        const s = fs.readFileSync(path.join(ROOT, rel), 'utf8');
        for (const re of RES) for (const m of s.matchAll(re)) {
          const around = s.slice(Math.max(0, m.index - 700), m.index + m[0].length + 300);
          const isEmail = re === RES[1] || EMAILISH.test(around);
          if (isEmail && m[0].includes('var(--k-')) bad.push(rel);
        }
      }
    }
    assert.deepEqual([...new Set(bad)], []);
  });
});
