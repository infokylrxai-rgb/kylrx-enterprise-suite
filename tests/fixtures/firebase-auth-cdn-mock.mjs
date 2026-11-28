/** Stand-in for the Firebase Auth CDN module: no one signs in during these tests. */
export function onAuthStateChanged(_auth, _cb) { return () => {}; }
