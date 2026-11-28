/*
 * Makes sure every icon actually appears.
 *
 * Lucide converts an <i> carrying a data-lucide attribute into an SVG only when createIcons() runs. Most
 * of this app builds its screens by assigning innerHTML - 526 of those insertions
 * contain an icon - and each one needs another createIcons() call afterwards. Miss it
 * and the icon is not broken or wrong, it is simply absent: an empty gap where a symbol
 * should be, with nothing in the console to say so.
 *
 * Auditing 526 call sites would fix it once and rot immediately, because the next person
 * to add a row has to remember. Watching the document instead covers every case,
 * including markup added by code written later.
 *
 * The observer is cheap: it does nothing unless a node carrying data-lucide is added,
 * and conversions are batched on an animation frame so a loop that appends fifty rows
 * converts once rather than fifty times.
 */
(function () {
  'use strict';

  var pending = false;

  function convert() {
    pending = false;
    if (!window.lucide || typeof window.lucide.createIcons !== 'function') return;
    try {
      window.lucide.createIcons();
    } catch (_) {
      // A malformed icon must never take the page down with it.
    }
  }

  function schedule() {
    if (pending) return;
    pending = true;
    (window.requestAnimationFrame || window.setTimeout)(convert, 16);
  }

  function holdsIcon(node) {
    if (!node || node.nodeType !== 1) return false;
    if (node.hasAttribute && node.hasAttribute('data-lucide')) return true;
    return typeof node.querySelector === 'function' && node.querySelector('[data-lucide]') !== null;
  }

  function watch() {
    convert();                                  // whatever is already on the page

    if (typeof MutationObserver !== 'function') return;
    new MutationObserver(function (records) {
      for (var i = 0; i < records.length; i++) {
        var added = records[i].addedNodes;
        for (var j = 0; j < added.length; j++) {
          if (holdsIcon(added[j])) { schedule(); return; }
        }
      }
    }).observe(document.documentElement, { childList: true, subtree: true });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', watch);
  else watch();
})();
