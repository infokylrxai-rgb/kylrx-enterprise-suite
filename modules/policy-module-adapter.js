const UnifiedModuleContract = require('../services/unified-module-contract');
const logger = require('../utils/logger');
const { db } = require('../config/firebase');

/**
 * Policy Center Module Adapter
 * Exposes policy publication, mandatory acknowledgement events, and compliance tracking
 */
const policyModuleAdapter = new UnifiedModuleContract({
    moduleKey: 'policy_center',
    moduleName: 'Policy & Compliance Center',
    description: 'Manages enterprise code of conduct, statutory policies, employee sign-offs, and compliance auditing.',

    triggers: [
        {
            name: 'policy.acknowledged',
            label: 'Policy Acknowledged',
            description: 'Fired when an employee electronically signs and acknowledges a mandatory policy.',
            samplePayload: { policyId: 'POL-01', policyTitle: 'IT Security Policy', employeeId: 'EMP-001', signedAt: '2026-09-11T12:00:00.000Z' }
        },
        {
            name: 'policy.assigned',
            label: 'Policy Assigned to Employee',
            description: 'Fired when a new policy is targeted to employees.',
            samplePayload: { policyId: 'POL-02', policyTitle: 'Anti-Harassment (POSH)', employeeId: 'EMP-001', dueDate: '2026-09-30' }
        },
        {
            name: 'policy.overdue',
            label: 'Policy Sign-off Overdue',
            description: 'Fired when policy sign-off deadline breaches SLA.',
            samplePayload: { policyId: 'POL-02', employeeId: 'EMP-001', daysOverdue: 5 }
        }
    ],

    conditions: [
        { field: 'policy.policyTitle', label: 'Policy Title', type: 'string' },
        { field: 'policy.isMandatory', label: 'Is Mandatory Policy', type: 'boolean' },
        { field: 'policy.category', label: 'Policy Category', type: 'string', allowedValues: ['Information Security', 'Workplace Conduct', 'Leave & Benefits', 'Statutory'] },
        { field: 'policy.daysOverdue', label: 'Days Overdue', type: 'number' }
    ],

    dataResolvers: {
        policy: async (policyId, context) => {
            try {
                if (db) {
                    const snap = await db.collection('policies').doc(policyId).get();
                    if (snap.exists) return snap.data();
                }
            } catch (e) {
                logger.warn(`[PolicyAdapter] Error resolving policy ${policyId}: ${e.message}`);
            }
            return { policyId, policyTitle: 'Enterprise Policy', isMandatory: true };
        }
    },

    actions: {
        'policy.assign_policy': async (params, context) => {
            logger.info(`[PolicyAdapter] 📜 Assigning policy '${params.policyId}' to employee: ${params.employeeId || context.entityId}`);
            return { success: true, assigned: true, policyId: params.policyId };
        },
        'policy.send_reminder': async (params, context) => {
            logger.info(`[PolicyAdapter] 🔔 Sending compliance reminder to employee: ${params.employeeId || context.entityId}`);
            return { success: true, reminderSent: true };
        }
    }
});

module.exports = policyModuleAdapter;
