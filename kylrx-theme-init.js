/*
 * Applies the colour theme before the page paints, and offers the switch.
 *
 * Loaded synchronously in <head>, ahead of the stylesheets, with no imports. If it ran
 * any later - after DOMContentLoaded, or as a module - the page would paint once in the
 * default theme and then repaint, which is the flash of the wrong theme the brief rules
 * out.
 *
 * Dark is the default for a first visit, as the brief specifies. Once a person chooses,
 * their choice is remembered on this device.
 */
(function () {
  'use strict';

  var KEY = 'kylrx_theme';                 // 'dark' | 'light'

  function stored() {
    try {
      var v = localStorage.getItem(KEY);
      return v === 'light' || v === 'dark' ? v : null;
    } catch (_) {
      return null;                         // private window, or site data blocked
    }
  }

  function apply(theme) {
    document.documentElement.setAttribute('data-theme', theme);
  }

  // Before paint: the stored choice, or dark.
  apply(stored() || 'dark');

  /*
   * Which portal this page belongs to, from its file name, so the four portals can be
   * told apart at a glance (kylrx-theme.css gives each its own marker colour). Set
   * before paint like the theme, so it never flickers.
   */
  function portalOf(pathname) {
    var file = String(pathname || '').split('/').pop().toLowerCase();
    if (/^(login|signup|index|employee-login|manager-login|hrms-login|forgot|reset)/.test(file) || file === '') return 'public';
    if (/^manager-/.test(file)) return 'manager';
    if (/^employee-/.test(file)) return 'employee';
    if (/^hrms-/.test(file)) return 'hr';
    return 'admin';
  }
  try { document.documentElement.setAttribute('data-portal', portalOf(location.pathname)); } catch (_) {}

  function set(theme) {
    if (theme !== 'light' && theme !== 'dark') return;
    try { localStorage.setItem(KEY, theme); } catch (_) {}
    apply(theme);
    paint();
    // Charts and anything else that reads colours in script can redraw.
    try { window.dispatchEvent(new CustomEvent('kylrx-theme-change', { detail: { theme: theme } })); } catch (_) {}
  }

  function current() {
    return document.documentElement.getAttribute('data-theme') === 'light' ? 'light' : 'dark';
  }

  function paint() {
    var btn = document.getElementById('kylrxThemeToggle');
    if (!btn) return;
    var dark = current() === 'dark';
    btn.setAttribute('aria-pressed', String(dark));
    btn.setAttribute('aria-label', dark ? 'Switch to light theme' : 'Switch to dark theme');
    btn.title = btn.getAttribute('aria-label');
    btn.textContent = dark ? '☾' : '☀';     // moon / sun
  }

  /*
   * The switch goes in the page's top bar when it has one, and floats otherwise, so
   * every page offers it without each needing its own markup.
   */
  function build() {
    if (document.getElementById('kylrxThemeToggle')) { paint(); return; }
    var btn = document.createElement('button');
    btn.type = 'button';
    btn.id = 'kylrxThemeToggle';
    btn.style.cssText =
      'display:inline-flex;align-items:center;justify-content:center;width:36px;height:36px;' +
      'border-radius:10px;border:1px solid var(--k-border);background:var(--k-surface);' +
      'color:var(--k-text);font-size:16px;line-height:1;cursor:pointer;flex:none;';
    btn.addEventListener('click', function () { set(current() === 'dark' ? 'light' : 'dark'); });

    var bar = document.querySelector('.topbar .top-actions, .topbar-right, .header-actions, .top-nav-actions, .topbar');
    if (bar) {
      bar.appendChild(btn);
    } else {
      btn.style.position = 'fixed';
      btn.style.right = '16px';
      btn.style.bottom = '16px';
      btn.style.zIndex = '9999';
      btn.style.boxShadow = 'var(--k-shadow)';
      document.body.appendChild(btn);
    }
    paint();
  }

  /*
   * Chart.js draws in a canvas, which a stylesheet cannot reach, and nothing in the app
   * ever set its defaults - so axis labels used Chart.js's own grey, which is barely
   * legible on the dark theme. Its text and line defaults now follow the theme tokens,
   * and every live chart is redrawn when the theme changes.
   */
  function token(name) {
    return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  }
  function themeCharts() {
    var C = window.Chart;
    if (!C || !C.defaults) return;
    C.defaults.color = token('--k-muted') || C.defaults.color;
    C.defaults.borderColor = 'rgba(128, 128, 128, 0.18)';
    var live = C.instances ? Object.values(C.instances) : [];
    for (var i = 0; i < live.length; i++) {
      try { live[i].update('none'); } catch (_) {}
    }
  }
  window.addEventListener('kylrx-theme-change', themeCharts);

  /*
   * Accessibility the pages share, applied once the page is parsed:
   *  - a "Skip to main content" link, so keyboard users need not tab through the
   *    whole sidebar on every page;
   *  - the sidebar named as navigation;
   *  - icon-only buttons and links named from their title or icon, so a screen reader
   *    says "Delete" rather than "button".
   */
  var PORTAL_NAMES = { admin: 'Admin portal', manager: 'Manager portal', employee: 'Employee portal', hr: 'HR portal' };
  function enhance() {
    var main = document.querySelector('main, .main-content, [role="main"]');
    if (main) {
      if (!main.id) main.id = 'kylrxMain';
      if (!main.hasAttribute('tabindex')) main.setAttribute('tabindex', '-1');
      if (!document.getElementById('kylrxSkipLink') && document.body) {
        var skip = document.createElement('a');
        skip.id = 'kylrxSkipLink';
        skip.className = 'kylrx-skip-link';
        skip.href = '#' + main.id;
        skip.textContent = 'Skip to main content';
        document.body.insertBefore(skip, document.body.firstChild);
      }
    }
    var side = document.querySelector('aside, .sidebar');
    if (side && !side.getAttribute('aria-label')) {
      side.setAttribute('aria-label', 'Main navigation');
      if (side.tagName && side.tagName.toLowerCase() !== 'nav' && !side.getAttribute('role')) side.setAttribute('role', 'navigation');
    }
    nameIconOnlyControls(document);
    var portal = document.documentElement.getAttribute('data-portal');
    if (side && side.querySelector && PORTAL_NAMES[portal] && !side.querySelector('.kylrx-portal-tag')) {
      var tag = document.createElement('div');
      tag.className = 'kylrx-portal-tag';
      tag.textContent = PORTAL_NAMES[portal];
      side.insertBefore(tag, side.firstChild);
    }
  }
  function nameIconOnlyControls(root) {
    var list = root.querySelectorAll ? root.querySelectorAll('button, a[href], [role="button"]') : [];
    for (var i = 0; i < list.length; i++) {
      var el = list[i];
      if (el.getAttribute('aria-label') || el.getAttribute('aria-labelledby')) continue;
      if (String(el.textContent || '').trim()) continue;
      var icon = el.querySelector && el.querySelector('[data-lucide]');
      var label = el.getAttribute('title') ||
        (icon ? String(icon.getAttribute('data-lucide')).replace(/-/g, ' ') : '');
      if (label) el.setAttribute('aria-label', label.charAt(0).toUpperCase() + label.slice(1));
    }
  }
  window.KylrxA11y = { nameIconOnlyControls: nameIconOnlyControls, portalOf: portalOf };

  function start() { build(); themeCharts(); try { enhance(); } catch (err) { console.error('[Theme] accessibility pass failed:', err); } }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();
  // Chart.js is often loaded late; catch it once the page has finished loading too.
  window.addEventListener('load', themeCharts);

  window.KylrxTheme = { set: set, get: current };
})();
