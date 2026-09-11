import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

import recruitmentIntegrationService from '../services/recruitment-integration-service.js';

describe('19. Recruitment Flow & ATS Integration Suite', () => {

    // 1. Keep recruitment flow built earlier intact
    it('1. Keeps recruitment flow built earlier intact (stages, rounds, and candidate workflow)', async () => {
        // Read recruitment-service.js to verify core recruitment flow constants and functions
        const servicePath = path.resolve(rootDir, 'recruitment-service.js');
        assert.ok(fs.existsSync(servicePath), 'recruitment-service.js must exist');
        const content = fs.readFileSync(servicePath, 'utf8');

        // Verify the 6 pipeline stages
        assert.ok(content.includes('Applied'));
        assert.ok(content.includes('Screening'));
        assert.ok(content.includes('Interview'));
        assert.ok(content.includes('Offer'));
        assert.ok(content.includes('Hired'));
        assert.ok(content.includes('Rejected'));

        // Verify interview rounds
        assert.ok(content.includes('Phone Screen'));
        assert.ok(content.includes('Technical'));
        assert.ok(content.includes('HR'));
        assert.ok(content.includes('Final'));

        // Verify automatic offer-to-onboarding token bridge
        assert.ok(content.includes('patch.stage === "Offer"'), 'Must trigger onboarding bridge when stage is Offer');
        assert.ok(content.includes('onboardingToken'), 'Must generate onboardingToken for new employee');
        assert.ok(content.includes('onboarding-invite.html'), 'Must construct onboarding invite link');
    });

    // 2. Maintained as an integration with an additional 10k per year in the plan
    it('2. Maintained as an independent integration add-on with additional ₹10,000/year in the plan', () => {
        const config = recruitmentIntegrationService.getIntegrationConfig();
        assert.equal(config.id, 'recruitment_ats');
        assert.equal(config.annualPrice, 10000, 'Must be priced at ₹10,000 per year');
        assert.equal(config.currency, 'INR');
        assert.equal(config.billingCadence, 'annual');
        assert.ok(config.priceDisplay.includes('10,000') || config.priceDisplay.includes('10k'), 'Price display must reflect 10k/yr');
        assert.equal(config.includedInGeneralHRMS, false, 'Must NOT be included in general HRMS');
    });

    // 3. Excluded from general HRMS and its base plans
    it('3. Explicitly excluded from general HRMS base plans (Starter, Growth, Scale, Enterprise)', () => {
        const catalog = recruitmentIntegrationService.getPlansCatalog();
        assert.ok(Array.isArray(catalog.generalHRMS));
        assert.ok(catalog.generalHRMS.length >= 3);

        // Verify each base plan excludes recruitment ATS
        for (const plan of catalog.generalHRMS) {
            assert.equal(
                plan.includesRecruitmentATS,
                false,
                `Base HRMS tier '${plan.tier}' must NOT include Recruitment ATS`
            );
        }

        // Verify Recruitment ATS is exclusively an add-on integration
        const addOn = catalog.addOns.find(a => a.id === 'recruitment_ats');
        assert.ok(addOn, 'Recruitment ATS must be listed in add-on integrations');
        assert.equal(addOn.annualPrice, 10000);
        assert.equal(addOn.includedInGeneralHRMS, false);
    });

    // 4. Integration status toggle and audit recording
    it('4. Supports enabling and disabling integration with Stage 8 audit tracking', async () => {
        // Toggle to disabled
        const disabledState = await recruitmentIntegrationService.setIntegrationStatus(false, {
            actor: 'HR Director',
            notes: 'Testing add-on deactivation'
        });
        assert.equal(disabledState.enabled, false);
        assert.equal(recruitmentIntegrationService.isIntegrationEnabled(), false);

        // Toggle back to active
        const enabledState = await recruitmentIntegrationService.setIntegrationStatus(true, {
            actor: 'HR Director',
            notes: 'Subscribed to Recruitment Flow Add-on (₹10,000/yr)'
        });
        assert.equal(enabledState.enabled, true);
        assert.equal(recruitmentIntegrationService.isIntegrationEnabled(), true);
    });

    // 5. REST API verification
    it('5. REST API exposes /api/integrations/recruitment and /api/integrations/plans', async () => {
        const res = await fetch('http://localhost:3000/api/integrations/recruitment');
        assert.equal(res.status, 200);
        const json = await res.json();
        assert.equal(json.success, true);
        assert.equal(json.integration.id, 'recruitment_ats');
        assert.equal(json.integration.annualPrice, 10000);
        assert.equal(json.integration.includedInGeneralHRMS, false);

        const plansRes = await fetch('http://localhost:3000/api/integrations/plans');
        assert.equal(plansRes.status, 200);
        const plansJson = await plansRes.json();
        assert.equal(plansJson.success, true);
        assert.ok(plansJson.catalog.generalHRMS.length >= 3);
        assert.equal(plansJson.recruitmentAddOnPolicy.annualPrice, 10000);
        assert.equal(plansJson.recruitmentAddOnPolicy.bundledInGeneralHRMS, false);
    });

    // 6. UI Badges and Integration Banners in hrms-dashboard.html and admin-settings.html
    it('6. hrms-dashboard.html and admin-settings.html display Add-On Integration badges and ₹10,000/yr pricing notice', () => {
        const hrmsHtml = fs.readFileSync(path.resolve(rootDir, 'hrms-dashboard.html'), 'utf8');
        assert.ok(hrmsHtml.includes('Add-on Integration'), 'hrms-dashboard must contain Add-on Integration badge');
        assert.ok(hrmsHtml.includes('10,000') || hrmsHtml.includes('10k'), 'hrms-dashboard must mention 10,000 or 10k price');
        assert.ok(hrmsHtml.includes('Unbundled from General HRMS') || hrmsHtml.includes('Excluded from general HRMS'), 'hrms-dashboard must mention unbundled policy');

        const settingsHtml = fs.readFileSync(path.resolve(rootDir, 'admin-settings.html'), 'utf8');
        assert.ok(settingsHtml.includes('data-tab="integrations"'), 'admin-settings must have integrations tab');
        assert.ok(settingsHtml.includes('Recruitment Flow &amp; ATS Integration') || settingsHtml.includes('Recruitment Flow & ATS Integration'));
        assert.ok(settingsHtml.includes('₹10,000'), 'admin-settings must show ₹10,000 / year pricing');
        assert.ok(settingsHtml.includes('Excluded from General HRMS Plans'));
    });
});
