import test from 'node:test';
import assert from 'node:assert/strict';
import centralAssignmentEngine from '../services/central-assignment-engine.js';
import eventBus from '../services/event-bus.js';

test('5. Employee Type + Business Unit Assignment Engine', async (t) => {

    await t.test('1. Matrix Resolution across 7 inputs and 10 functional assignment categories', async () => {
        // Full-Time Technology Employee in India
        const inputs = {
            legalEntity: 'Kylrx Technologies India Pvt Ltd',
            businessUnit: 'Technology',
            employeeType: 'Full Time',
            location: 'Bengaluru',
            department: 'Engineering',
            grade: 'L3'
        };

        const result = centralAssignmentEngine.resolveAssignments(inputs);
        assert.ok(result, 'Resolution result should exist');
        assert.equal(result.matchedRuleId, 'RULE_FT_TECH_IN');

        const { assignments } = result;

        // Verify all 10 categories are populated
        // 1. Payroll structure
        assert.ok(assignments.payrollStructure);
        assert.equal(assignments.payrollStructure.basicSalaryPct, 50);
        assert.equal(assignments.payrollStructure.payoutCycle, 'MONTHLY_LAST_DAY');

        // 2. Statutory configuration
        assert.ok(assignments.statutoryConfig);
        assert.equal(assignments.statutoryConfig.epfEnabled, true);
        assert.equal(assignments.statutoryConfig.professionalTaxState, 'Karnataka');

        // 3. Policies
        assert.ok(Array.isArray(assignments.policies));
        assert.ok(assignments.policies.includes('Intellectual Property & Invention Assignment'));
        assert.ok(assignments.policies.includes('Hybrid & Remote Work Agreement'));

        // 4. Document requirements
        assert.ok(Array.isArray(assignments.documentRequirements));
        assert.ok(assignments.documentRequirements.includes('Degree Graduation Certificate'));
        assert.ok(assignments.documentRequirements.includes('Previous Relieving Letter'));

        // 5. Onboarding flow
        assert.equal(assignments.onboardingFlow, 'tech_engineering_onboarding_v2');

        // 6. PMS
        assert.ok(assignments.pms);
        assert.equal(assignments.pms.cadence, 'QUARTERLY_OKRS');

        // 7. Attendance/Leave rules
        assert.ok(assignments.attendanceLeaveRules);
        assert.equal(assignments.attendanceLeaveRules.annualLeaveDays, 24);
        assert.equal(assignments.attendanceLeaveRules.biometricGeoFenceRequired, true);

        // 8. Exit flow
        assert.equal(assignments.exitFlow, 'standard_13_step_exit_flow');

        // 9. Approval flow
        assert.ok(assignments.approvalFlow);
        assert.deepEqual(assignments.approvalFlow.tiers, ['Reporting Manager', 'Engineering VP', 'HRBP', 'Finance Controller']);

        // 10. Alert rules
        assert.ok(Array.isArray(assignments.alertRules));
        assert.ok(assignments.alertRules.includes('Probation 60-Day Review Notification'));
    });

    await t.test('2. Specificity scoring & Employee-Specific Overrides (100% priority)', async () => {
        // Employee with specific override for remote allowance and customized policies
        const inputsWithOverrides = {
            legalEntity: 'Kylrx Technologies India Pvt Ltd',
            businessUnit: 'Technology',
            employeeType: 'Full Time',
            location: 'Bengaluru',
            department: 'Engineering',
            grade: 'L5',
            overrides: {
                attendanceLeaveRules: {
                    annualLeaveDays: 30 // Executive override from 24 to 30
                },
                policies: [
                    'Executive Non-Compete Agreement',
                    'Code of Business Conduct & Ethics'
                ]
            }
        };

        const result = centralAssignmentEngine.resolveAssignments(inputsWithOverrides);
        assert.equal(result.assignments.attendanceLeaveRules.annualLeaveDays, 30, 'Override must take precedence over rule default');
        assert.deepEqual(result.assignments.policies, [
            'Executive Non-Compete Agreement',
            'Code of Business Conduct & Ethics'
        ], 'Override policies must replace matrix rule policies');
    });

    await t.test('3. Configuration Impact Analysis when Employee Type changes (Contractor -> Full Time)', async () => {
        const currentAttributes = {
            employeeId: 'EMP_VIKRAM_99',
            legalEntity: 'Kylrx Technologies India Pvt Ltd',
            businessUnit: 'Technology',
            employeeType: 'Contractor',
            department: 'Technology'
        };

        const prospectiveAttributes = {
            employeeId: 'EMP_VIKRAM_99',
            legalEntity: 'Kylrx Technologies India Pvt Ltd',
            businessUnit: 'Technology',
            employeeType: 'Full Time', // Converted to Full Time!
            department: 'Engineering'
        };

        const impact = centralAssignmentEngine.calculateConfigurationImpact(currentAttributes, prospectiveAttributes);

        assert.equal(impact.hasImpact, true, 'Converting Contractor to Full-Time must have configuration impact');
        assert.ok(impact.diffSummaryList.length > 0, 'Should generate actionable human-readable diff lines');

        // Verify impact details across key categories:
        // Attendance/Leave: 0 days -> 24 days
        assert.equal(impact.categories.attendanceLeaveRules.status, 'MODIFIED');
        assert.equal(impact.categories.attendanceLeaveRules.current.annualLeaveDays, 0);
        assert.equal(impact.categories.attendanceLeaveRules.prospective.annualLeaveDays, 24);

        // Statutory: EPF was false, now true
        assert.equal(impact.categories.statutoryConfig.status, 'MODIFIED');
        assert.equal(impact.categories.statutoryConfig.current.epfEnabled, false);
        assert.equal(impact.categories.statutoryConfig.prospective.epfEnabled, true);

        // Policies: New policies added
        assert.equal(impact.categories.policies.status, 'MODIFIED');
        assert.ok(impact.categories.policies.changes.some(c => c.includes('Added:')));

        // Exit flow: contractor release -> standard 13-step flow
        assert.equal(impact.categories.exitFlow.status, 'MODIFIED');
        assert.equal(impact.categories.exitFlow.current, 'contractor_release_expedited_flow');
        assert.equal(impact.categories.exitFlow.prospective, 'standard_13_step_exit_flow');
    });

    await t.test('4. Effective-Date Temporal Versioning & Historical Record Preservation', async () => {
        const employeeId = 'EMP_ALEX_042';
        const futureEffectiveDate = '2026-10-01T00:00:00.000Z';

        let transitionEventFired = false;
        const listener = (evt) => {
            if (evt.employeeId === employeeId) transitionEventFired = true;
        };
        eventBus.on('assignment.transition_applied', listener);

        // Initial setup as Contractor
        await centralAssignmentEngine.applyAssignmentTransition(
            employeeId,
            { employeeType: 'Contractor', businessUnit: 'Technology' },
            '2026-01-01T00:00:00.000Z',
            'HR Admin',
            'Initial contractor onboarding'
        );

        // Transition to Full Time effective Oct 1, 2026
        const transitionResult = await centralAssignmentEngine.applyAssignmentTransition(
            employeeId,
            {
                legalEntity: 'Kylrx Technologies India Pvt Ltd',
                businessUnit: 'Technology',
                employeeType: 'Full Time',
                department: 'Engineering',
                grade: 'L3'
            },
            futureEffectiveDate,
            'VP of People Operations',
            'Full-Time Conversion & Regularization'
        );

        assert.equal(transitionResult.success, true);
        assert.equal(transitionResult.effectiveDate, futureEffectiveDate);
        assert.equal(transitionResult.status, 'SCHEDULED', 'Future effective date should be marked as SCHEDULED');

        // Verify Historical Preservation guarantees:
        assert.equal(transitionResult.preservedHistoricalRecords.historicalPayrollPreserved, true);
        assert.equal(transitionResult.preservedHistoricalRecords.historicalDocumentsPreserved, true);
        assert.equal(transitionResult.preservedHistoricalRecords.policyAcknowledgementsPreserved, true);
        assert.ok(transitionResult.preservedHistoricalRecords.auditSealedHash);

        // Verify history timeline holds the previous contractor record
        const history = centralAssignmentEngine.getAssignmentHistory(employeeId);
        assert.ok(history.length >= 1, 'History timeline must retain previous assignment versions');
        assert.equal(history[0].validUntil, futureEffectiveDate, 'Historical record validUntil must match transition effectiveDate');

        eventBus.off('assignment.transition_applied', listener);
        assert.equal(transitionEventFired, true, 'EventBus should notify downstream modules of assignment update');
    });
});
