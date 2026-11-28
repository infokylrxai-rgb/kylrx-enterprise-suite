/**
 * Node module-resolution hook: any import of firebase-config.js resolves to the test
 * stand-in. Registered with module.register() by tests that drive browser code which
 * dynamically imports './firebase-config.js'.
 */
const MOCK = new URL('./firebase-config-mock.mjs', import.meta.url).href;

export async function resolve(specifier, context, nextResolve) {
  if (/(^|\/)firebase-config\.js$/.test(specifier)) {
    return { url: MOCK, shortCircuit: true };
  }
  return nextResolve(specifier, context);
}
