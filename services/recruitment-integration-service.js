const crypto = require('crypto');
const logger = require('../utils/logger');
const automationEngine = require('./automation-engine');

/**
 * Recruitment Integration Service (Kylrx Enterprise Suite — Feature 19)
 * 
 * Rules:
 * 1. Keep the recruitment flow built earlier as it is, but maintain it as an integration.
 * 2. Keep the additional 10k per year (₹10,000/yr) for it in the plan.
 * 3. It will NOT be included in the general HRMS and its plans.
 */

class RecruitmentIntegrationService {
    constructor() {
        this.config = {
            id: 'recruitment_ats',
            name: 'Recruitment Flow & ATS Integration',
            category: 'Talent Acquisition & Candidate Pipeline',
            annualPrice: 10000,
            currency: 'INR',
            billingCadence: 'annual',
            priceDisplay: '₹10,000 / year',
            includedInGeneralHRMS: false, // Strictly separate from general HRMS plans
            enabled: true, // Default active for demonstration and enterprise evaluation
            activatedAt: '2026-01-01T00:00:00.000Z',
            activatedBy: 'Super Admin',
            version: '2.1.0',
            description: 'Independent enterprise integration for full-lifecycle applicant tracking, AI resume screening, stage management, and automated offer-to-onboarding transitions. Billed separately as an annual add-on.',
            features: [
                'Full Multi-Stage Candidate Pipeline (Applied, Screening, Interview, Offer, Hired, Rejected)',
                'Interview Rounds Management & Scoring (Phone, Technical, HR, Final)',
                'Kylrx AI - Recruitment Copilot & Departmental Talent Analytics',
                'Automatic Offer-to-Onboarding Token & Account Bridge',
                'Resume Vault & Secure File Storage',
                'Recruitment Event Telemetry wired to EventBus'
            ]
        };

        this.planStructure = {
            generalHRMSPlans: [
                {
                    tier: 'Starter',
                    monthlyPrice: 2999,
                    annualPrice: 29990,
                    includesRecruitmentATS: false,
                    features: ['Core HR & Directory', 'Leave & Attendance Tracking', 'Employee Self-Service Portal']
                },
                {
                    tier: 'Growth',
                    monthlyPrice: 7999,
                    annualPrice: 79990,
                    includesRecruitmentATS: false,
                    features: ['All Starter Features', 'Automated Payroll & Tax Forms', 'Performance & Goal Setting']
                },
                {
                    tier: 'Scale',
                    monthlyPrice: 14999,
                    annualPrice: 149990,
                    includesRecruitmentATS: false,
                    features: ['All Growth Features', 'Statutory Compliance (PF/ESIC/Gratuity)', 'Custom Workflow Builder', 'Advanced Analytics']
                },
                {
                    tier: 'Enterprise',
                    customPricing: true,
                    includesRecruitmentATS: false, // Even enterprise base plan keeps ATS unbundled as an optional add-on
                    features: ['Dedicated Account Manager', 'Custom SLA & 99.99% Uptime', 'Tailored Multi-Entity Support']
                }
            ],
            addOnIntegrations: [
                {
                    id: 'recruitment_ats',
                    name: 'Recruitment Flow & ATS Integration',
                    annualPrice: 10000,
                    currency: 'INR',
                    priceDisplay: '₹10,000 / year',
                    includedInGeneralHRMS: false,
                    description: 'Optional annual integration add-on. Unbundled from base HRMS plans.'
                }
            ]
        };
    }

    /**
     * Get integration details and subscription status
     */
    getIntegrationConfig() {
        return {
            ...this.config,
            isIncludedInGeneralHRMS: false,
            pricingNotice: 'Recruitment ATS is an independent integration add-on billed at ₹10,000/year and is not included in general HRMS plans.'
        };
    }

    /**
     * Check if recruitment integration is active
     */
    isIntegrationEnabled() {
        return this.config.enabled === true;
    }

    /**
     * Toggle integration status (Enable / Disable add-on)
     */
    async setIntegrationStatus(enabled, { actor = 'Super Admin', notes = '' } = {}) {
        const previousStatus = this.config.enabled;
        this.config.enabled = Boolean(enabled);
        this.config.updatedAt = new Date().toISOString();
        this.config.lastModifiedBy = actor;

        logger.info(`[RecruitmentIntegration] Integration status changed from ${previousStatus} to ${this.config.enabled} by ${actor}.`);

        // Record Stage 8 Audit Trail
        try {
            await automationEngine.recordAuditLog({
                runId: `recruitment-addon-${Date.now()}`,
                automationId: 'recruitment-ats-integration',
                stage: 'Integration Configuration Change',
                status: this.config.enabled ? 'enabled' : 'disabled',
                details: {
                    integrationId: this.config.id,
                    annualPrice: this.config.annualPrice,
                    currency: this.config.currency,
                    includedInGeneralHRMS: false,
                    actor,
                    notes
                }
            });
        } catch (e) {
            logger.warn(`[RecruitmentIntegration] Audit log warning: ${e.message}`);
        }

        return this.getIntegrationConfig();
    }

    /**
     * Get pricing plans comparing base HRMS vs. Recruitment Add-on
     */
    getPlansCatalog() {
        return {
            generalHRMS: this.planStructure.generalHRMSPlans,
            addOns: this.planStructure.addOnIntegrations,
            recruitmentAddOn: {
                annualPrice: this.config.annualPrice,
                currency: this.config.currency,
                priceDisplay: this.config.priceDisplay,
                includedInGeneralHRMS: false,
                status: this.config.enabled ? 'active' : 'inactive'
            }
        };
    }
}

module.exports = new RecruitmentIntegrationService();
