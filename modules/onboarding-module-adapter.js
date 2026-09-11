const UnifiedModuleContract = require('../services/unified-module-contract');
const logger = require('../utils/logger');
const { db } = require('../config/firebase');

/**
 * Onboarding Module Adapter
 * Exposes Onboarding triggers, condition variables, data resolvers, and actions
 */
const onboardingModuleAdapter = new UnifiedModuleContract({
    moduleKey: 'onboarding',
    moduleName: 'Onboarding & Candidate Management',
    description: 'Manages candidate invitation, document submission, verification, and employee provisioning.',

    triggers: [
        {
            name: 'onboarding.candidate_invited',
            label: 'Candidate Invited',
            description: 'Fired when an invitation email is dispatched to a new hire.',
            samplePayload: { candidateId: 'CAND_101', email: 'hire@example.com', department: 'Engineering', role: 'Developer' }
        },
        {
            name: 'onboarding.documents_submitted',
            label: 'Documents Submitted',
            description: 'Fired when a candidate completes document uploads (Aadhaar, PAN, Bank details).',
            samplePayload: { candidateId: 'CAND_101', documentsCount: 4, allRequiredPresent: true }
        },
        {
            name: 'onboarding.verification_completed',
            label: 'Verification Completed',
            description: 'Fired when HR or background checker approves candidate verification.',
            samplePayload: { candidateId: 'CAND_101', status: 'verified', verifiedBy: 'hr_admin' }
        },
        {
            name: 'employee.created',
            label: 'Employee Created',
            description: 'Fired when a new employee profile is provisioned in the core HR system.',
            samplePayload: { employeeId: 'EMP_101', name: 'Alex Mercer', department: 'Engineering', employeeType: 'Full Time' }
        },
        {
            name: 'employee.type.changed',
            label: 'Employee Type Changed',
            description: 'Fired when an employee status changes (e.g. Intern to Full Time, Contractor to Permanent).',
            samplePayload: { employeeId: 'EMP_101', previousType: 'Intern', newType: 'Full Time', department: 'Engineering' }
        }
    ],

    conditions: [
        { field: 'candidate.department', label: 'Department', type: 'string' },
        { field: 'candidate.role', label: 'Designation / Role', type: 'string' },
        { field: 'candidate.employment_type', label: 'Employment Type', type: 'string', allowedValues: ['Full-time', 'Part-time', 'Contract', 'Intern'] },
        { field: 'candidate.documentsCount', label: 'Uploaded Documents Count', type: 'number' },
        { field: 'candidate.allRequiredPresent', label: 'All Required Docs Present', type: 'boolean' }
    ],

    dataResolvers: {
        candidate: async (candidateId, context) => {
            try {
                if (db) {
                    const snap = await db.collection('onboarding_invites').doc(candidateId).get();
                    if (snap.exists) return snap.data();
                }
            } catch (e) {
                logger.warn(`[OnboardingAdapter] Error resolving candidate ${candidateId}: ${e.message}`);
            }
            return { candidateId, department: 'Engineering', status: 'pending' };
        }
    },

    actions: {
        'onboarding.provision_account': async (params, context) => {
            logger.info(`[OnboardingAdapter] 👤 Provisioning corporate email & workspace account for candidate: ${params.candidateId || context.entityId}`);
            // Update candidate status
            if (db && (params.candidateId || context.entityId)) {
                try {
                    db.collection('onboarding_invites').doc(params.candidateId || context.entityId).set({
                        provisioned: true,
                        provisionedAt: new Date().toISOString()
                    }, { merge: true }).catch(() => {});
                } catch (e) {}
            }
            return { success: true, provisioned: true };
        },

        'onboarding.request_document_reupload': async (params, context) => {
            logger.info(`[OnboardingAdapter] 📄 Requesting document re-upload for: ${params.candidateId || context.entityId} (Reason: ${params.reason || 'Blurry document'})`);
            return { success: true, reuploadRequested: true };
        },

        'onboarding.assign_buddy_mentor': async (params, context) => {
            logger.info(`[OnboardingAdapter] 🤝 Assigning onboarding mentor/buddy to candidate: ${params.candidateId || context.entityId}`);
            return { success: true, assignedBuddy: params.buddyEmail || 'mentor@kylrx.ai' };
        }
    }
});

module.exports = onboardingModuleAdapter;
