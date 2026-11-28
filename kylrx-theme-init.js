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

  function start() { build(); themeCharts(); }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();
  // Chart.js is often loaded late; catch it once the page has finished loading too.
  window.addEventListener('load', themeCharts);

  window.KylrxTheme = { set: set, get: current };
})();
