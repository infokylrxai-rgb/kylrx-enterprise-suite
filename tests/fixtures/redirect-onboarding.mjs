/**
 * Node module-resolution hook for driving admin-onboarding-upload.js: firebase-config.js
 * and the Firebase Auth CDN import both resolve to local stand-ins.
 */
const CONFIG = new URL('./firebase-config-mock.mjs', import.meta.url).href;
const AUTH = new URL('./firebase-auth-cdn-mock.mjs', import.meta.url).href;

export async function resolve(specifier, context, nextResolve) {
  if (/(^|\/)firebase-config\.js$/.test(specifier)) return { url: CONFIG, shortCircuit: true };
  if (/^https:\/\/www\.gstatic\.com\/firebasejs\/.*\/firebase-auth\.js$/.test(specifier)) return { url: AUTH, shortCircuit: true };
  return nextResolve(specifier, context);
}
