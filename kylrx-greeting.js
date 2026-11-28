/*
 * Fills the welcome heading before the page paints.
 *
 * Extracted from the theme layer when that was removed, because this part is not about
 * appearance: the greeting used to render a placeholder and swap in the real name a
 * moment later, so the heading visibly jumped on every load. The name is already in
 * storage from the last session, so it is written before the first paint. admin-app.js
 * still corrects it once the profile loads, but for a returning person the two agree and
 * nothing moves.
 *
 * Plain script, no imports, loaded in <head>: it has to run before paint to be any use.
 */
(function () {
  'use strict';

  function paintGreeting() {
    var el = document.getElementById('welcomeUserName');
    if (!el || el.textContent.trim()) return;

    var name = '';
    try {
      name = localStorage.getItem('userName') || localStorage.getItem('user_name') || '';
    } catch (_) {
      return;                       // private window, or site data blocked
    }
    if (!name || name.indexOf('@') > -1) return;   // never show an email as a name

    // The comma travels with the name, so "Welcome back," is never left dangling while
    // the real value resolves.
    el.textContent = ', ' + name.split(' ')[0];
  }

  // The heading exists well before DOMContentLoaded, so try as soon as it appears.
  if (document.readyState === 'loading') {
    document.addEventListener('readystatechange', paintGreeting);
    document.addEventListener('DOMContentLoaded', paintGreeting);
  } else {
    paintGreeting();
  }

  window.KylrxGreeting = { paint: paintGreeting };
})();
