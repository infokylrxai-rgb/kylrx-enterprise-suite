import { describe, it } from 'node:test';
import assert from 'node:assert';
import controlsAcceptanceService from '../services/controls-acceptance-service.js';

describe('4. Controls, Acceptance and Client Confirmation Suite (PRD §4)', () => {

    // =========================================================================
    // 4.1 COMMON PLATFORM REQUIREMENTS
    // =========================================================================
    describe('4.1 Common Platform Requirements', () => {

        it('4.1.1 Permissions: Access must follow role-based rules', () => {
            const summary = controlsAcceptanceService.getPlatformRequirementsSummary();
            assert.ok(summary.requirements.permissions, 'Permissions section must exist');
            assert.strictEqual(summary.requirements.permissions.status, 'compliant');
            assert.deepStrictEqual(
                summary.requirements.permissions.canonicalRoles,
                ['super_admin', 'manager', 'hr_payroll', 'employee']
            );
            assert.strictEqual(summary.requirements.permissions.scopeBoundariesEnforced, true);
        });

        it('4.1.2 Audit: Record important changes and actions across all modules', () => {
            const summary = controlsAcceptanceService.getPlatformRequirementsSummary();
            assert.ok(summary.requirements.audit, 'Audit section must exist');
            assert.strictEqual(summary.requirements.audit.status, 'compliant');
            assert.ok(summary.requirements.audit.totalLoggedEvents > 0, 'Should have logged audit events');
            assert.ok(summary.requirements.audit.trackedModules.includes('goals'));
            assert.ok(summary.requirements.audit.trackedModules.includes('payroll_rules'));
            assert.strictEqual(summary.requirements.audit.immutableLedgersActive, true);
        });

        it('4.1.3 Security: Protect employee and payroll information with dynamic masking', () => {
            const summary = controlsAcceptanceService.getPlatformRequirementsSummary();
            assert.ok(summary.requirements.security, 'Security section must exist');
            assert.strictEqual(summary.requirements.security.status, 'compliant');
            assert.strictEqual(summary.requirements.security.maskingEnforced, true);
            assert.ok(summary.requirements.security.maskedFields.includes('bankAccountNumber'));
            assert.ok(summary.requirements.security.maskedFields.includes('taxId_PAN'));
            assert.strictEqual(summary.requirements.security.maskingPattern, '••••••••1234');
        });

        it('4.1.4 Reliability: Handle bulk jobs and provider failures safely', () => {
            const summary = controlsAcceptanceService.getPlatformRequirementsSummary();
            assert.ok(summary.requirements.reliability, 'Reliability section must exist');
            assert.strictEqual(summary.requirements.reliability.status, 'compliant');
            assert.ok(summary.requirements.reliability.batchProcessingEngine.includes('5x20'));
            assert.ok(summary.requirements.reliability.failureHandling.includes('Dead-letter'));
        });

        it('4.1.5 Usability: Provide clear forms, previews and explicit status messages', () => {
            const summary = controlsAcceptanceService.getPlatformRequirementsSummary();
            assert.ok(summary.requirements.usability, 'Usability section must exist');
            assert.strictEqual(summary.requirements.usability.status, 'compliant');
            assert.strictEqual(summary.requirements.usability.schemaValidationGates, true);
            assert.ok(summary.requirements.usability.livePreviewEngines.length >= 2);
        });

        it('4.1.6 Reporting: Show goal, template, notification and job status metrics', () => {
            const summary = controlsAcceptanceService.getPlatformRequirementsSummary();
            assert.ok(summary.requirements.reporting, 'Reporting section must exist');
            assert.strictEqual(summary.requirements.reporting.status, 'compliant');
            assert.ok(typeof summary.requirements.reporting.activeGoalsCount === 'number');
            assert.ok(typeof summary.requirements.reporting.usableTemplatesCount === 'number');
            assert.ok(typeof summary.requirements.reporting.bulkJobsProcessed === 'number');
        });
    });

    // =========================================================================
    // 4.2 ACCEPTANCE CRITERIA MATRIX (8 CANONICAL FEATURES)
    // =========================================================================
    describe('4.2 Acceptance Criteria Matrix Verification', () => {

        it('4.2.1 All 8 acceptance conditions pass live verification', async () => {
            const verification = await controlsAcceptanceService.verifyAcceptanceCriteria();

            assert.strictEqual(verification.overallStatus, 'PASSED');
            assert.strictEqual(verification.criteria.length, 8);

            const featureMap = new Map(verification.criteria.map(c => [c.feature, c]));

            // Condition 1: Goals
            const goals = featureMap.get('Goals');
            assert.ok(goals, 'Goals criterion must be evaluated');
            assert.strictEqual(goals.condition, 'Manager can create, update and track goals.');
            assert.strictEqual(goals.passed, true);

            // Condition 2: Templates
            const templates = featureMap.get('Templates');
            assert.ok(templates, 'Templates criterion must be evaluated');
            assert.strictEqual(templates.condition, 'Each agreed module has a usable template setup.');
            assert.strictEqual(templates.passed, true);

            // Condition 3: Bulk actions
            const bulk = featureMap.get('Bulk actions');
            assert.ok(bulk, 'Bulk actions criterion must be evaluated');
            assert.strictEqual(bulk.condition, 'System validates, processes and reports outcomes.');
            assert.strictEqual(bulk.passed, true);

            // Condition 4: OTP
            const otp = featureMap.get('OTP');
            assert.ok(otp, 'OTP criterion must be evaluated');
            assert.strictEqual(otp.condition, 'Expiry, single-use and attempt limits work.');
            assert.strictEqual(otp.passed, true);

            // Condition 5: AI builder
            const ai = featureMap.get('AI builder');
            assert.ok(ai, 'AI builder criterion must be evaluated');
            assert.strictEqual(ai.condition, 'Suggestions are editable and require user approval.');
            assert.strictEqual(ai.passed, true);

            // Condition 6: Payroll
            const payroll = featureMap.get('Payroll');
            assert.ok(payroll, 'Payroll criterion must be evaluated');
            assert.strictEqual(payroll.condition, 'Approved settings and notification rules work as agreed.');
            assert.strictEqual(payroll.passed, true);

            // Condition 7: Account view
            const account = featureMap.get('Account view');
            assert.ok(account, 'Account view criterion must be evaluated');
            assert.strictEqual(account.condition, 'Users cannot access unauthorised information.');
            assert.strictEqual(account.passed, true);

            // Condition 8: Audit
            const audit = featureMap.get('Audit');
            assert.ok(audit, 'Audit criterion must be evaluated');
            assert.strictEqual(audit.condition, 'Important actions show who acted and when.');
            assert.strictEqual(audit.passed, true);
        });
    });

    // =========================================================================
    // 4.3 CLIENT DECISIONS REQUIRED
    // =========================================================================
    describe('4.3 Client Decisions Required Management', () => {

        it('4.3.1 Pre-seeds all 10 client decision points with recommended defaults from handwritten notes', () => {
            const decisions = controlsAcceptanceService.getAllClientDecisions();
            assert.strictEqual(decisions.length, 10, 'Must have exactly 10 decision points');

            const expectedQuestions = [
                'Which modules need separate templates?',
                'Can managers publish templates, or require approval?',
                'Are goals personal, team-based, or both?',
                'Does bulk triggering mean email, alerts, workflows or OTP?',
                'Are 100 recipients and batches of 20 correct figures?',
                'Which OTP channel and provider will be used?',
                'Which AI builder is required first?',
                'What exactly does the payroll deduction note mean?',
                'What does “view account” refer to?',
                'Which payroll provider and approval rules apply?'
            ];

            decisions.forEach((d, idx) => {
                assert.strictEqual(d.question, expectedQuestions[idx]);
                assert.ok(d.recommendedOption, `Decision ${d.id} must have recommended option`);
                assert.ok(d.options.length >= 2, `Decision ${d.id} must have selectable options`);
            });
        });

        it('4.3.2 Records individual client decision and updates confirmation status', () => {
            const updated = controlsAcceptanceService.recordClientDecision(
                'dec_otp_channel_provider',
                {
                    selectedOption: 'Dual-Channel: Twilio SMS (Primary) with SendGrid / SMTP Email Fallback',
                    notes: 'Confirmed by IT Security Lead. Twilio for critical OTP, email for secondary.'
                },
                {
                    id: 'usr-client-cio',
                    name: 'Chief Information Officer',
                    organization: 'Enterprise Client Corp'
                }
            );

            assert.strictEqual(updated.status, 'confirmed');
            assert.strictEqual(updated.confirmedBy.name, 'Chief Information Officer');
            assert.strictEqual(updated.notes.includes('Confirmed by IT Security Lead'), true);
        });

        it('4.3.3 Batch confirms all recommendations in 1-click', () => {
            const batchResult = controlsAcceptanceService.batchConfirmAllRecommendations({
                id: 'client-rep-legal',
                name: 'Jane Doe',
                role: 'Head of People Operations'
            });

            assert.strictEqual(batchResult.length, 10);
            const allDecisions = controlsAcceptanceService.getAllClientDecisions();
            const allConfirmed = allDecisions.every(d => d.status === 'confirmed');
            assert.strictEqual(allConfirmed, true, 'All 10 decisions must now be confirmed');
        });
    });

    // =========================================================================
    // 4.4 RECOMMENDED NEXT STEPS & CLIENT SIGN-OFF
    // =========================================================================
    describe('4.4 Recommended Next Steps & Digital Sign-Off Execution', () => {

        it('4.4.1 Returns 5 delivery phases with story points totaling 215', () => {
            const roadmap = controlsAcceptanceService.getDeliveryRoadmap();
            assert.strictEqual(roadmap.phases.length, 5);
            assert.strictEqual(roadmap.totalStoryPoints, 215);
            assert.ok(roadmap.scopeNote.includes('This five-page document is based on the supplied handwritten notes'));
            assert.strictEqual(roadmap.recommendedNextSteps.length, 5);
        });

        it('4.4.2 Enforces validation on client sign-off parameters', () => {
            assert.throws(() => {
                controlsAcceptanceService.recordClientApproval({
                    representativeName: '',
                    representativeTitle: 'Director'
                });
            }, /Client representative name is required/);

            assert.throws(() => {
                controlsAcceptanceService.recordClientApproval({
                    representativeName: 'Alice Johnson',
                    representativeTitle: ''
                });
            }, /Representative title \/ designation is required/);
        });

        it('4.4.3 Generates tamper-evident cryptographic sign-off certificate', () => {
            const cert = controlsAcceptanceService.recordClientApproval({
                representativeName: 'Marcus Vance',
                representativeTitle: 'VP of Human Capital',
                organization: 'Kylrx Global Enterprises',
                signatureDate: '2026-10-19',
                clientComments: 'Requirements approved for development sprint scheduling.',
                signOffScope: 'Full 5-Page PRD Scope'
            });

            assert.ok(cert.certificateId.startsWith('KYLRX-CERT-'));
            assert.strictEqual(cert.certificateHash.length, 64, 'SHA-256 hash must be 64 characters');
            assert.strictEqual(cert.representativeName, 'Marcus Vance');
            assert.strictEqual(cert.representativeTitle, 'VP of Human Capital');
            assert.strictEqual(cert.status, 'approved_and_sealed');
            assert.strictEqual(cert.confirmedDecisionsCount, 10);

            const latest = controlsAcceptanceService.getLatestSignOff();
            assert.strictEqual(latest.certificateId, cert.certificateId);
        });
    });
});
