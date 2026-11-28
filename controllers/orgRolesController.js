'use strict';

/**
 * Role management for an organisation's own people.
 *
 * Until now a role was fixed at creation: set on the employee form or the onboarding
 * workbook, written into the claims when the login was issued, and never changeable
 * through the product again. Staff change roles constantly, so the only way to promote
 * somebody was to edit the record and re-provision, or open the Firebase console.
 *
 * Everything here is scoped to the caller's own organisation, taken from their verified
 * token and never from the request. Changing a role is privilege escalation by
 * definition, so the guards are the substance of this file, not an afterthought:
 *
 *   - you can only see and change people in your own organisation;
 *   - you cannot change your own role, so nobody can quietly promote themselves;
 *   - the last remaining super admin cannot be demoted, which would lock the
 *     organisation out of its own administration with no way back in;
 *   - only a super admin can grant super admin;
 *   - the claim and the Firestore document are written together, so the two cannot
 *     disagree about who somebody is.
 */

const { admin, db } = require('../config/firebase');
const logger = require('../utils/logger');

/** The roles an organisation may assign to its own people. */
const ASSIGNABLE_ROLES = [
  { value: 'employee',   label: 'Employee' },
  { value: 'manager',    label: 'Reporting Manager' },
  { value: 'hr_admin',   label: 'HR Admin' },
  { value: 'hr_payroll', label: 'Payroll Specialist' },
  { value: 'super_admin', label: 'Super Admin' }
];
const ASSIGNABLE = new Set(ASSIGNABLE_ROLES.map(r => r.value));

const normalize = (role) => String(role || '').toLowerCase().replace(/[\s_-]+/g, '');
const isSuperAdminRole = (role) => ['superadmin'].includes(normalize(role));

function requireOrg(req, res) {
  const orgId = req.user && req.user.orgId;
  if (!orgId) {
    res.status(400).json({ success: false, error: 'No organization on your account.' });
    return null;
  }
  return orgId;
}

/** GET - everyone in the caller's organisation, with the role each currently holds. */
exports.listOrgMembers = async (req, res) => {
  const orgId = requireOrg(req, res);
  if (!orgId) return;
  if (!db || typeof db.collection !== 'function') {
    return res.status(503).json({ success: false, error: 'Database is not available.' });
  }

  try {
    const people = new Map();   // uid or doc id -> row
    for (const collection of ['users', 'employees']) {
      const snap = await db.collection(collection).where('orgId', '==', orgId).get();
      snap.forEach(docSnap => {
        const d = docSnap.data() || {};
        const email = String(d.email || '').toLowerCase().trim();
        if (!email) return;
        const existing = people.get(email);
        // A users row keyed by the Auth uid is the authoritative one; an employees row is
        // a placeholder until a login is issued.
        const hasLogin = collection === 'users' && d.uid === docSnap.id;
        if (existing && !hasLogin) return;
        people.set(email, {
          uid: hasLogin ? docSnap.id : (d.uid || null),
          email,
          name: d.name || d.displayName || email,
          role: d.role || 'employee',
          departmentId: d.departmentId || '',
          active: d.active !== false,
          hasLogin: Boolean(hasLogin || d.uid),
          source: collection
        });
      });
    }

    const members = [...people.values()].sort((a, b) => a.name.localeCompare(b.name));
    return res.json({
      success: true,
      orgId,
      assignableRoles: ASSIGNABLE_ROLES,
      superAdminCount: members.filter(m => isSuperAdminRole(m.role)).length,
      you: req.user && req.user.uid,
      members
    });
  } catch (err) {
    logger.error(`[ORG-ROLES] list failed for ${orgId}: ${err.message}`);
    return res.status(503).json({ success: false, error: 'Could not read your organization\'s people.' });
  }
};

/** PATCH /:uid/role - change one person's role. */
exports.updateMemberRole = async (req, res) => {
  const orgId = requireOrg(req, res);
  if (!orgId) return;

  const targetUid = String(req.params.uid || '').trim();
  const role = String((req.body && req.body.role) || '').trim();

  if (!targetUid) return res.status(400).json({ success: false, error: 'Which person?' });
  if (!ASSIGNABLE.has(role)) {
    return res.status(400).json({ success: false, error: `Role must be one of: ${[...ASSIGNABLE].join(', ')}` });
  }
  if (targetUid === (req.user && req.user.uid)) {
    return res.status(403).json({ success: false, error: 'You cannot change your own role. Ask another super admin.' });
  }
  if (isSuperAdminRole(role) && !isSuperAdminRole(req.user && req.user.role)) {
    return res.status(403).json({ success: false, error: 'Only a super admin can grant super admin.' });
  }

  try {
    // The person must belong to the caller's organisation. Read it from the record rather
    // than trusting the uid in the path to be one of ours.
    const profileRef = db.collection('users').doc(targetUid);
    const profile = await profileRef.get();
    if (!profile.exists) {
      return res.status(404).json({ success: false, error: 'That person was not found.' });
    }
    const data = profile.data() || {};
    if (data.orgId !== orgId) {
      // Same answer as "not found" on purpose: a different tenant's uid must not be
      // distinguishable from one that does not exist.
      return res.status(404).json({ success: false, error: 'That person was not found.' });
    }

    // Never leave an organisation with no super admin: there would be nobody able to
    // restore one, including through this page.
    if (isSuperAdminRole(data.role) && !isSuperAdminRole(role)) {
      const supers = await db.collection('users').where('orgId', '==', orgId).where('role', '==', data.role).get();
      if (supers.size <= 1) {
        return res.status(409).json({
          success: false,
          error: 'This is your organization\'s only super admin. Promote someone else first, then change this one.'
        });
      }
    }

    const existingClaims = (await admin.auth().getUser(targetUid)).customClaims || {};
    await admin.auth().setCustomUserClaims(targetUid, {
      ...existingClaims,
      role,
      orgId,
      ...(isSuperAdminRole(role) ? { super_admin: true } : { super_admin: false })
    });
    await profileRef.set({ role, updatedAt: new Date().toISOString() }, { merge: true });

    logger.info(`[ORG-ROLES] ${orgId}: ${data.email || targetUid} -> ${role} (by ${(req.user && req.user.email) || 'unknown'})`);
    return res.json({
      success: true,
      uid: targetUid,
      role,
      message: `${data.name || data.email || 'That person'} is now ${role}. They may need to sign out and back in.`
    });
  } catch (err) {
    if (err.code === 'auth/user-not-found') {
      return res.status(404).json({ success: false, error: 'That person has no login yet. Issue their login first.' });
    }
    logger.error(`[ORG-ROLES] role change failed in ${orgId}: ${err.message}`);
    return res.status(500).json({ success: false, error: 'Could not change that role.' });
  }
};

exports.ASSIGNABLE_ROLES = ASSIGNABLE_ROLES;
