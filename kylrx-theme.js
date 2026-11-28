/*
 * Theme switching, and collapsible navigation groups.
 *
 * Deliberately a plain script with no imports: it has to run before the page paints, or
 * a dark-theme user gets a white flash on every navigation. It is loaded in <head>, and
 * sets the theme from storage before the body exists.
 *
 * Three settings rather than two. "System" is the default, so the product matches what
 * the person already chose for their machine instead of insisting on an opinion.
 */
(function () {
  'use strict';

  var STORAGE_KEY = 'kylrx_theme';          // 'light' | 'dark' | 'system'
  var NAV_KEY = 'kylrx_nav_collapsed';
  var media = window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)') : null;

  function stored() {
    try { return localStorage.getItem(STORAGE_KEY) || 'system'; } catch (_) { return 'system'; }
  }

  function resolve(choice) {
    if (choice === 'light' || choice === 'dark') return choice;
    return media && media.matches ? 'dark' : 'light';
  }

  function apply(choice) {
    document.documentElement.setAttribute('data-theme', resolve(choice));
    document.documentElement.setAttribute('data-theme-choice', choice);
  }

  // Before paint. Everything below waits for the DOM.
  apply(stored());

  // Following the system means following it as it changes, not only at load.
  if (media && media.addEventListener) {
    media.addEventListener('change', function () {
      if (stored() === 'system') apply('system');
    });
  }

  function setChoice(choice) {
    try { localStorage.setItem(STORAGE_KEY, choice); } catch (_) {}
    apply(choice);
    paintToggle();
  }

  function paintToggle() {
    var current = stored();
    var buttons = document.querySelectorAll('.kylrx-theme-toggle button[data-choice]');
    for (var i = 0; i < buttons.length; i++) {
      buttons[i].setAttribute('aria-pressed', String(buttons[i].dataset.choice === current));
    }
  }

  function buildToggle() {
    if (document.querySelector('.kylrx-theme-toggle')) return;
    var wrap = document.createElement('div');
    wrap.className = 'kylrx-theme-toggle';
    wrap.setAttribute('role', 'group');
    wrap.setAttribute('aria-label', 'Colour theme');
    wrap.innerHTML =
      '<button type="button" data-choice="light" title="Light">Light</button>' +
      '<button type="button" data-choice="system" title="Match my device">Auto</button>' +
      '<button type="button" data-choice="dark" title="Dark">Dark</button>';
    wrap.addEventListener('click', function (e) {
      var btn = e.target.closest('button[data-choice]');
      if (btn) setChoice(btn.dataset.choice);
    });
    document.body.appendChild(wrap);
    paintToggle();
  }

  /*
   * Collapsible sidebar groups. The admin sidebar carries around forty links under five
   * headings, all expanded, which is the single biggest reason the product feels heavy.
   * Clicking a heading folds its group, and the choice is remembered.
   */
  function wireNavGroups() {
    var labels = document.querySelectorAll('.sidebar .nav-label');
    if (!labels.length) return;

    var collapsed = {};
    try { collapsed = JSON.parse(localStorage.getItem(NAV_KEY) || '{}'); } catch (_) {}

    Array.prototype.forEach.call(labels, function (label) {
      var key = (label.textContent || '').trim();

      // Everything up to the next heading belongs to this group.
      var items = [];
      var node = label.nextElementSibling;
      while (node && !node.classList.contains('nav-label')) {
        items.push(node);
        node = node.nextElementSibling;
      }

      function render(isCollapsed) {
        label.classList.toggle('collapsed', isCollapsed);
        label.setAttribute('aria-expanded', String(!isCollapsed));
        items.forEach(function (el) { el.style.display = isCollapsed ? 'none' : ''; });
      }

      // A group holding the current page is never folded away, or the person loses
      // their place.
      var holdsActive = items.some(function (el) { return el.querySelector && el.querySelector('.nav-link.active'); });
      render(Boolean(collapsed[key]) && !holdsActive);

      label.setAttribute('role', 'button');
      label.setAttribute('tabindex', '0');
      label.addEventListener('click', function () {
        var next = !label.classList.contains('collapsed');
        render(next);
        collapsed[key] = next;
        try { localStorage.setItem(NAV_KEY, JSON.stringify(collapsed)); } catch (_) {}
      });
      label.addEventListener('keydown', function (e) {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); label.click(); }
      });
    });
  }

  function init() { buildToggle(); wireNavGroups(); }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();

  window.KylrxTheme = { set: setChoice, get: stored, resolved: function () { return resolve(stored()); } };
})();
