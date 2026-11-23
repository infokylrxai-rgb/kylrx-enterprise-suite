/**
 * Firebase Storage paths: every file lives under orgs/{orgId}/... (see storage.rules), and the
 * organization comes from the verified token (firebase-config.js tenantReady), never from the page.
 * Pure helpers are separate from orgStoragePath so they can be unit-tested without Firebase.
 */

/**
 * One safe path segment from any input (ids, period keys, file names): no slashes, no "." or ".."
 * segments, no control characters, at most 120 characters. Throws when nothing usable is left.
 */
export function safeSegment(value) {
    const cleaned = String(value ?? '')
        .normalize('NFKC')
        .replace(/[^A-Za-z0-9._-]+/g, '_')
        .replace(/^[._]+/, '')
        .slice(0, 120);
    if (!cleaned || /^\.+$/.test(cleaned)) throw new Error('Invalid file or id name for storage.');
    return cleaned;
}

/** The file's extension, lower case and safe, or the fallback */
export function safeExtension(fileName, fallback = 'bin') {
    const m = /\.([A-Za-z0-9]{1,8})$/.exec(String(fileName || ''));
    return m ? m[1].toLowerCase() : fallback;
}

/** orgs/{orgId}/<segments...> with every segment made safe */
export function buildOrgPath(orgId, ...segments) {
    if (!orgId) throw new Error('No organization found for the signed-in user.');
    return ['orgs', safeSegment(orgId), ...segments.map(safeSegment)].join('/');
}

/** The same path for the signed-in user's organization */
export async function orgStoragePath(...segments) {
    const { tenantReady, getActiveOrgId } = await import('./firebase-config.js');
    await tenantReady;
    return buildOrgPath(getActiveOrgId(), ...segments);
}
