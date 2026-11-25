'use strict';

/**
 * Works out which organisation a Cashfree callback belongs to, so the signature can be
 * checked against THAT organisation's secret.
 *
 * Every tenant now pays from its own gateway, so there is no single webhook secret left
 * to verify against. Cashfree posts every tenant's callbacks to the same URL, and the
 * only thing distinguishing them is the transfer id in the body.
 *
 * That forces an uncomfortable ordering: the payload has to be read BEFORE it has been
 * proven genuine. This module exists to keep that step as small and as dull as possible.
 * It does exactly one thing - pulls a transfer id out and looks it up in an index this
 * server itself wrote at dispatch time - and it:
 *
 *   - reads only the transfer id, never a figure, a status or an account number;
 *   - treats that id as a lookup key and nothing else, rejecting anything that is not a
 *     plain Firestore document id, so it cannot be steered at another path;
 *   - trusts the INDEX for the organisation, never the body. A forged callback naming a
 *     real transfer id resolves to the organisation that transfer was really dispatched
 *     for, and is then rejected because it cannot be signed with that tenant's secret;
 *   - resolves nothing for an unknown id, so an attacker cannot invent a transfer and
 *     have it verified against a tenant of their choosing.
 *
 * Nothing here decides anything. It returns an orgId; the caller still verifies.
 */

const MAX_ID = 200;

/**
 * Firestore document ids cannot contain "/", cannot be "." or "..", and we additionally
 * require the character set Cashfree transfer ids actually use. Anything else is treated
 * as absent rather than cleaned up: a transfer id we did not mint is not one we indexed.
 */
function safeDocId(value) {
  const id = String(value == null ? '' : value).trim();
  if (!id || id.length > MAX_ID) return null;
  if (id === '.' || id === '..') return null;
  if (!/^[A-Za-z0-9_.|-]+$/.test(id)) return null;
  return id;
}

/**
 * Pulls the transfer id out of an unverified body, reading nothing else.
 * Mirrors the shapes Cashfree uses across v1 and v2.
 */
function extractTransferId(body) {
  if (!body || typeof body !== 'object') return null;
  const d = (body.data && typeof body.data === 'object') ? body.data : {};
  const t = (d.transfer && typeof d.transfer === 'object') ? d.transfer : {};
  return safeDocId(
    body.transferId || body.transfer_id ||
    d.transferId || d.transfer_id ||
    t.transferId || t.transfer_id ||
    null
  );
}

/**
 * @param {object} db        Firestore
 * @param {object} body      the UNVERIFIED webhook body
 * @returns {Promise<{transferId: string|null, orgId: string|null}>}
 */
async function resolveOrgFromWebhook(db, body) {
  const transferId = extractTransferId(body);
  if (!transferId) return { transferId: null, orgId: null };
  // No database is "could not look it up", NOT "unknown transfer". The difference matters:
  // unknown gets a 401 and Cashfree stops, while a lookup failure gets a 503 and Cashfree
  // retries. Confusing the two would strand real payouts as PENDING during an outage.
  if (!db || typeof db.collection !== 'function') return { transferId, orgId: null, lookupFailed: true };

  try {
    const snap = await db.collection('cashfree_transfer_index').doc(transferId).get();
    if (!snap || !snap.exists) return { transferId, orgId: null };
    const orgId = (snap.data() || {}).orgId || null;
    return { transferId, orgId: orgId ? String(orgId) : null };
  } catch (_) {
    // A lookup failure must not be mistaken for "unknown transfer": the caller decides
    // what to do, and a 503 is more honest than silently rejecting a real callback.
    return { transferId, orgId: null, lookupFailed: true };
  }
}

module.exports = { resolveOrgFromWebhook, extractTransferId, safeDocId };
