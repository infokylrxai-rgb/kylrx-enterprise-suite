/**
 * Part 8 of the overhaul brief: never silently turn a failed request into an empty
 * screen, and never globally suppress meaningful Firebase errors.
 *
 * Three ways this app did both:
 *
 *  1. When a read was refused, the getDocs/onSnapshot wrappers returned an empty snapshot
 *     and announced it with a 'firestore-permission-denied' event. Nothing listened. A
 *     refused read and a genuinely empty collection looked identical on screen.
 *  2. The Firebase SDK's own log level was 'silent', suppressing its errors along with
 *     its retry chatter.
 *  3. Calls that read or wrote data, or reached the network, were wrapped in
 *     try { ... } catch (_) {} - the failure vanished entirely.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const config = fs.readFileSync(path.join(ROOT, 'firebase-config.js'), 'utf8');

function extract(src, name) {
  const start = src.indexOf('function ' + name + '(');
  assert.ok(start > -1, name + ' not found');
  let depth = 0;
  for (let j = src.indexOf('{', start); j < src.length; j++) {
    if (src[j] === '{') depth++;
    else if (src[j] === '}' && --depth === 0) return src.slice(start, j + 1);
  }
  throw new Error('unterminated ' + name);
}

/** A DOM just big enough to render the notice into and read it back. */
function fakeDocument() {
  const appended = [];
  const make = (tag) => {
    const node = {
      tag, children: [], style: {}, attributes: {}, textContent: '', listeners: {},
      setAttribute(k, v) { this.attributes[k] = v; },
      addEventListener(type, fn) { this.listeners[type] = fn; },
      append(...kids) { this.children.push(...kids); },
      remove() { const i = appended.indexOf(this); if (i > -1) appended.splice(i, 1); }
    };
    Object.defineProperty(node.style, 'cssText', { writable: true, value: '' });
    return node;
  };
  return {
    readyState: 'complete',
    body: { appendChild: (n) => appended.push(n) },
    createElement: make,
    appended
  };
}

function loadNotice() {
  const document = fakeDocument();
  // eslint-disable-next-line no-new-func
  const show = new Function('document', 'window',
    'let _dataNoticeShown = false;\n' + extract(config, 'showDataUnavailableNotice') + '\nreturn showDataUnavailableNotice;'
  )(document, { location: { reload() {} } });
  return { show, document };
}

describe('a refused read is shown to the person, not rendered as empty', () => {
  it('the permission event has a listener', () => {
    assert.match(config, /addEventListener\('firestore-permission-denied', showDataUnavailableNotice\)/);
  });

  it('it renders a visible alert', () => {
    const { show, document } = loadNotice();
    show();
    assert.equal(document.appended.length, 1, 'expected one notice on the page');
    const bar = document.appended[0];
    assert.equal(bar.attributes.role, 'alert', 'screen readers must announce it');
    assert.match(bar.children[0].textContent, /couldn't be loaded/);
  });

  it('it offers a retry and a way to dismiss it', () => {
    const { show, document } = loadNotice();
    show();
    const [, retry, close] = document.appended[0].children;
    assert.equal(retry.textContent, 'Retry');
    assert.equal(close.attributes['aria-label'], 'Dismiss');
    close.listeners.click();
    assert.equal(document.appended.length, 0, 'dismissing removes it');
  });

  it('it appears once, however many reads fail', () => {
    const { show, document } = loadNotice();
    show(); show(); show();
    assert.equal(document.appended.length, 1);
  });

  it('it tells the person nothing internal', () => {
    // Which collection failed and why is detail for the console, not the screen.
    const { show, document } = loadNotice();
    show();
    const text = document.appended[0].children[0].textContent;
    assert.doesNotMatch(text, /permission|firestore|collection|orgId/i);
  });
});

describe('the Firebase SDK reports its errors', () => {
  it('its log level is error, not silent', () => {
    assert.match(config, /setLogLevel\('error'\)/);
    assert.match(config, /setFirestoreLogLevel\('error'\)/);
    assert.doesNotMatch(config, /setLogLevel\('silent'\)/);
  });
});

describe('a data or network call never fails silently', () => {
  it('no empty catch guards a read, write, network call or sign-out', () => {
    const DATA = /getDocs|getDoc\b|setDoc|updateDoc|addDoc|deleteDoc|onSnapshot|runTransaction|commit\(|fetch\(|signOut|getIdToken|getEmployee[A-Za-z]*\(/;
    const EXPECTED = /getDocsFromCache|getDocFromCache/;    // a cache miss is normal
    const offenders = [];
    for (const f of fs.readdirSync(ROOT).filter(x => /\.(html|js)$/.test(x))) {
      const s = fs.readFileSync(path.join(ROOT, f), 'utf8');
      for (const m of s.matchAll(/try\s*\{([^{}]{0,260})\}\s*catch\s*(\([^)]*\))?\s*\{\s*\}/g)) {
        if (DATA.test(m[1]) && !EXPECTED.test(m[1])) offenders.push(f + ': ' + m[1].replace(/\s+/g, ' ').trim().slice(0, 60));
      }
    }
    assert.deepEqual(offenders, [], 'these failures would vanish without trace:\n  ' + offenders.join('\n  '));
  });
});
