const UnifiedModuleContract = require('../services/unified-module-contract');
const logger = require('../utils/logger');
const { db } = require('../config/firebase');

/**
 * Statutory Compliance Module Adapter
 * Exposes PF ECR, ESIC Monthly Returns, Gratuity Valuations, and NPS CRA Submissions
 */
const statutoryModuleAdapter = new UnifiedModuleContract({
    moduleKey: 'statutory_compliance',
    moduleName: 'Statutory Compliance (PF / ESIC / Gratuity / NPS)',
    description: 'Manages Indian statutory compliances including EPFO ECR files, ESIC portal returns, Payment of Gratuity Act calculations, and NSDL CRA batches.',

    triggers: [
        {
            name: 'statutory.pf_ecr_due',
            label: 'PF ECR Filing Due',
            description: 'Fired when the 15th of the month statutory deadline for EPFO filing approaches.',
            samplePayload: { cycleMonth: '2026-09', eligibleCount: 140, totalEPFContribution: 840000 }
        },
        {
            name: 'statutory.esic_return_due',
            label: 'ESIC Return Due',
            description: 'Fired when ESIC monthly contribution calculations are finalized.',
            samplePayload: { cycleMonth: '2026-09', coveredEmployees: 35, totalESICContribution: 42000 }
        },
        {
            name: 'statutory.gratuity_claim_filed',
            label: 'Gratuity Claim Filed',
            description: 'Fired when an exiting employee with >= 5 years tenure requests gratuity settlement.',
            samplePayload: { employeeId: 'EMP-012', tenureYears: 6.5, lastDrawnBasic: 60000, claimAmount: 225000 }
        },
        {
            name: 'statutory.nps_batch_ready',
            label: 'Corporate NPS Batch Ready',
            description: 'Fired when Corporate NPS employee and employer contributions are computed.',
            samplePayload: { cycleMonth: '2026-09', subscribersCount: 45, totalNpsAmount: 450000 }
        }
    ],

    conditions: [
        { field: 'statutory.totalEPFContribution', label: 'Total EPF Contribution', type: 'number' },
        { field: 'statutory.hasUanMissingExceptions', label: 'Missing UAN Exceptions', type: 'boolean' },
        { field: 'statutory.claimAmount', label: 'Gratuity Claim Amount', type: 'number' },
        { field: 'statutory.tenureYears', label: 'Employee Tenure in Years', type: 'number' }
    ],

    dataResolvers: {
        statutory_summary: async (cycleMonth, context) => {
            return { cycleMonth, totalEPF: 840000, totalESIC: 42000, totalNPS: 450000, isCompliant: true };
        }
    },

    actions: {
        'statutory.generate_ecr_file': async (params, context) => {
            logger.info(`[StatutoryAdapter] 📜 Generating EPFO raw pipe-delimited ECR file for cycle: ${params.cycleMonth || context.entityId}`);
            return { success: true, ecrGenerated: true, fileName: `EPFO_ECR_${params.cycleMonth || '2026_09'}.txt` };
        },

        'statutory.generate_esic_challan': async (params, context) => {
            logger.info(`[StatutoryAdapter] 🏥 Generating ESIC Portal Monthly Contribution Sheet for: ${params.cycleMonth || context.entityId}`);
            return { success: true, esicChallanGenerated: true, challanReference: 'ESIC-CHALLAN-9011' };
        },

        'statutory.approve_gratuity_settlement': async (params, context) => {
            logger.info(`[StatutoryAdapter] 🎖️ Approving Payment of Gratuity Act 1972 disbursement of ₹${params.amount || 225000} for: ${params.employeeId || context.entityId}`);
            return { success: true, gratuityApproved: true, voucherId: 'GRATUITY-VOUCH-7781' };
        },

        'statutory.generate_nsdl_scf': async (params, context) => {
            logger.info(`[StatutoryAdapter] 📈 Generating NSDL CRA Subscriber Contribution File (SCF) for NPS batch: ${params.cycleMonth || context.entityId}`);
            return { success: true, scfGenerated: true, scfRef: 'NSDL_CRA_SCF_202609' };
        }
    }
});

module.exports = statutoryModuleAdapter;
