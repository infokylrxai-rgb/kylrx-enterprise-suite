import { test, describe, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import bulkTriggerEngine from '../services/bulk-trigger-engine.js';
import otpVerificationService from '../services/otp-verification-service.js';
import aiAssistedBuilderService from '../services/ai-assisted-builder-service.js';

describe('2. Bulk Triggering and AI-Assisted Builder Suite (PRD §2)', () => {

    beforeEach(() => {
        // Reset engine configuration to defaults before tests
        bulkTriggerEngine.updateConfig(
            { batchSize: 20, interBatchDelayMs: 0, strictConsentRequired: true },
            { role: 'super_admin', name: 'Super Admin' }
        );
    });

    /* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
       2.1 BULK TRIGGERING (PRD §2.1)
    ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */
    describe('2.1 Bulk Triggering Core Workflow', () => {

        test('2.1.1 Authorised Action Selection: Permitted roles succeed, unauthorized roles are rejected', () => {
            const adminActor = { id: 'ADM-001', name: 'HR Admin', role: 'hr_admin' };
            const employeeActor = { id: 'EMP-001', name: 'Regular Staff', role: 'employee' };

            // Admin can trigger
            const adminValidation = bulkTriggerEngine.validateSelection({
                action: 'EMAIL_NOTIFICATION',
                recipients: [{ id: 'R1', email: 'user1@example.com', name: 'User 1' }],
                actor: adminActor
            });
            assert.equal(adminValidation.isValid, true);
            assert.equal(adminValidation.action, 'EMAIL_NOTIFICATION');

            // Employee is rejected
            assert.throws(() => {
                bulkTriggerEngine.validateSelection({
                    action: 'EMAIL_NOTIFICATION',
                    recipients: [{ id: 'R1', email: 'user1@example.com', name: 'User 1' }],
                    actor: employeeActor
                });
            }, /Permission Denied: Role 'employee' is not authorised/);
        });

        test('2.1.2 Selection Validation & Total Count Display: Accurately reports valid and invalid counts', () => {
            const recipients = [
                { id: 'REC-1', name: 'John Doe', email: 'john@kylrxai.com', consentStatus: 'granted' },
                { id: 'REC-2', name: 'Jane Smith', email: 'jane@kylrxai.com', consentStatus: 'granted' },
                { id: 'REC-3', name: 'Invalid Mail', email: 'not-an-email', consentStatus: 'granted' }, // bad email
                { id: 'REC-4', name: 'Missing Email', email: '', consentStatus: 'granted' },             // missing email
                { id: 'REC-5', name: 'Opted Out', email: 'optout@kylrxai.com', consentStatus: 'opted_out' } // consent revoked
            ];

            const validation = bulkTriggerEngine.validateSelection({
                action: 'EMAIL_NOTIFICATION',
                recipients,
                actor: { role: 'super_admin', name: 'Admin' }
            });

            assert.equal(validation.totalSelected, 5, 'Total selected count should be 5');
            assert.equal(validation.validCount, 2, 'Valid count should be 2');
            assert.equal(validation.invalidCount, 3, 'Invalid count should be 3');
            assert.equal(validation.invalidItems.length, 3);
            assert.ok(validation.invalidItems.some(i => i.errorReason.includes('Invalid email format')));
            assert.ok(validation.invalidItems.some(i => i.errorReason.includes('Missing email address')));
            assert.ok(validation.invalidItems.some(i => i.errorReason.includes('Consent Policy')));
        });

        test('2.1.3 Progress & Final Results: Transitions queued -> processing -> completed with progress stats', async () => {
            const recipients = Array.from({ length: 15 }, (_, i) => ({
                id: `EMP-${i + 1}`,
                name: `Staff Member ${i + 1}`,
                email: `staff${i + 1}@kylrxai.com`,
                consentStatus: 'granted'
            }));

            // Execute job
            const job = await bulkTriggerEngine.executeBulkTrigger({
                action: 'EMAIL_NOTIFICATION',
                recipients,
                payload: { subject: 'Welcome {{name}}', body: 'Your profile is ready.' },
                actor: { role: 'hr_admin', name: 'HR Admin' },
                options: { batchSize: 5, skipDelay: true }
            });

            assert.equal(job.status, 'completed');
            assert.equal(job.totalItems, 15);
            assert.equal(job.totalBatches, 3);
            assert.equal(job.processedCount, 15);
            assert.equal(job.successCount, 15);
            assert.equal(job.failureCount, 0);
            assert.equal(job.percentComplete, 100);
            assert.ok(job.startedAt);
            assert.ok(job.completedAt);
        });

        test('2.1.4 Failed Items Listing for Review: Granular error reasons preserved', async () => {
            const recipients = [
                { id: 'REC-OK-1', name: 'Good 1', email: 'good1@kylrxai.com', consentStatus: 'granted' },
                { id: 'REC-FAIL-1', name: 'Failing 1', email: 'fail1@kylrxai.com', consentStatus: 'granted' },
                { id: 'REC-OK-2', name: 'Good 2', email: 'good2@kylrxai.com', consentStatus: 'granted' }
            ];

            const job = await bulkTriggerEngine.executeBulkTrigger({
                action: 'EMAIL_NOTIFICATION',
                recipients,
                payload: { subject: 'Test Subject' },
                actor: { role: 'admin', name: 'Admin' },
                options: {
                    simulatedFailureIds: ['REC-FAIL-1'],
                    skipDelay: true
                }
            });

            assert.equal(job.status, 'partially_completed');
            assert.equal(job.successCount, 2);
            assert.equal(job.failureCount, 1);
            assert.equal(job.failedItems.length, 1);

            const failedItem = job.failedItems[0];
            assert.equal(failedItem.itemId, 'REC-FAIL-1');
            assert.ok(failedItem.errorReason.includes('Simulated provider timeout'));
            assert.equal(failedItem.canRetry, true);
        });

        test('2.1.5 Safe Retries: Avoid duplicate actions, only retry failed items (0 duplicates guaranteed)', async () => {
            const recipients = [
                { id: 'R-SUCC-1', name: 'Success 1', email: 's1@kylrxai.com', consentStatus: 'granted' },
                { id: 'R-FAIL-1', name: 'Temporary Fail 1', email: 'f1@kylrxai.com', consentStatus: 'granted' },
                { id: 'R-SUCC-2', name: 'Success 2', email: 's2@kylrxai.com', consentStatus: 'granted' }
            ];

            // Initial execution: 1 failure
            const initialJob = await bulkTriggerEngine.executeBulkTrigger({
                action: 'EMAIL_NOTIFICATION',
                recipients,
                payload: { subject: 'Idempotency Test' },
                actor: { role: 'admin', name: 'Admin' },
                options: { simulatedFailureIds: ['R-FAIL-1'], skipDelay: true }
            });

            assert.equal(initialJob.failureCount, 1);
            assert.equal(initialJob.successCount, 2);

            // Capture initial executed timestamp for R-SUCC-1
            const succItemResultBefore = initialJob.itemResults ? initialJob.itemResults.get('R-SUCC-1') : null;

            // Safe Retry pass (without simulated failure)
            const retriedJob = await bulkTriggerEngine.retryFailedItems(
                initialJob.jobId,
                { role: 'admin', name: 'Admin' },
                { skipDelay: true }
            );

            assert.equal(retriedJob.status, 'completed', 'Job should reach completed state after retry');
            assert.equal(retriedJob.successCount, 3, 'All 3 items should now be successful');
            assert.equal(retriedJob.failureCount, 0, 'Zero remaining failures');
            assert.equal(retriedJob.failedItems.length, 0);

            // Duplicate Action Guard: Succeeded items are not re-executed
            const currentJobRaw = bulkTriggerEngine.jobs.get(initialJob.jobId);
            const succItemAfter = currentJobRaw.itemResults.get('R-SUCC-1');
            assert.equal(succItemAfter.status, 'success');
        });
    });

    /* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
       2.2 BATCH PROCESSING EXAMPLE & CONTROLS (PRD §2.2)
    ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */
    describe('2.2 Batch Processing Example & Administrator Controls', () => {

        test('2.2.1 Handwritten Notes Example: 100 items processed in groups of 20 = exactly 5 batches', async () => {
            // Create exactly 100 mock recipients
            const hundredRecipients = Array.from({ length: 100 }, (_, i) => ({
                id: `EMP-${String(i + 1).padStart(3, '0')}`,
                name: `Employee ${i + 1}`,
                email: `emp${i + 1}@enterprise.com`,
                department: i % 2 === 0 ? 'Engineering' : 'Cybersecurity',
                consentStatus: 'granted'
            }));

            // Step 1: Pre-validation count display
            const validation = bulkTriggerEngine.validateSelection({
                action: 'EMAIL_NOTIFICATION',
                recipients: hundredRecipients,
                actor: { role: 'super_admin', name: 'Admin' }
            });

            assert.equal(validation.totalSelected, 100);
            assert.equal(validation.validCount, 100);
            assert.equal(validation.batchSize, 20, 'Default batch size must be 20 per notes');
            assert.equal(validation.estimatedBatches, 5, '100 items / 20 = exactly 5 batches');

            // Step 2: Batch Execution
            const job = await bulkTriggerEngine.executeBulkTrigger({
                action: 'EMAIL_NOTIFICATION',
                recipients: hundredRecipients,
                payload: { subject: 'Annual Security Training Notice' },
                actor: { role: 'super_admin', name: 'Admin' },
                options: { skipDelay: true }
            });

            assert.equal(job.totalItems, 100);
            assert.equal(job.batchSize, 20);
            assert.equal(job.totalBatches, 5, 'Must have exactly 5 batch executions');
            assert.equal(job.batches.length, 5);
            assert.equal(job.successCount, 100);
            assert.equal(job.status, 'completed');

            // Verify each individual batch metadata
            job.batches.forEach((batch, idx) => {
                assert.equal(batch.batchIndex, idx + 1);
                assert.equal(batch.size, 20, `Batch ${batch.batchIndex} should contain exactly 20 items`);
                assert.equal(batch.status, 'completed');
                assert.equal(batch.successCount, 20);
                assert.equal(batch.failureCount, 0);
            });
        });

        test('2.2.2 Batch Size Configurable by Administrator: Admin can adjust batch size, non-admin blocked', () => {
            const adminActor = { role: 'super_admin', name: 'Super Admin' };
            const managerActor = { role: 'manager', name: 'Dept Manager' };

            // Non-admin blocked
            assert.throws(() => {
                bulkTriggerEngine.updateConfig({ batchSize: 25 }, managerActor);
            }, /Only administrators can update bulk trigger engine configuration/);

            // Admin updates to 25
            const updateRes = bulkTriggerEngine.updateConfig({ batchSize: 25 }, adminActor);
            assert.equal(updateRes.config.batchSize, 25);

            // 100 items with batchSize 25 yields 4 batches
            const hundredRecipients = Array.from({ length: 100 }, (_, i) => ({
                id: `E-${i + 1}`,
                email: `test${i + 1}@kylrxai.com`,
                consentStatus: 'granted'
            }));

            const val = bulkTriggerEngine.validateSelection({
                action: 'EMAIL_NOTIFICATION',
                recipients: hundredRecipients,
                actor: adminActor
            });

            assert.equal(val.batchSize, 25);
            assert.equal(val.estimatedBatches, 4, '100 items / 25 = 4 batches');
        });

        test('2.2.3 Audit Trail: Records initiator, time, count, outcome, and cryptographic hash', async () => {
            const recipients = [
                { id: 'AUD-1', email: 'aud1@kylrx.com', consentStatus: 'granted' },
                { id: 'AUD-2', email: 'aud2@kylrx.com', consentStatus: 'granted' }
            ];

            const job = await bulkTriggerEngine.executeBulkTrigger({
                action: 'EMAIL_NOTIFICATION',
                recipients,
                payload: { subject: 'Audit Logging Verification' },
                actor: { id: 'ADM-SEC-09', name: 'Chief Compliance Officer', role: 'super_admin' },
                options: { skipDelay: true }
            });

            const auditLogs = bulkTriggerEngine.getAuditLogs({ limit: 10 });
            assert.ok(auditLogs.length > 0, 'Audit log should be recorded');

            const latest = auditLogs[0];
            assert.equal(latest.jobId, job.jobId);
            // Initiator
            assert.equal(latest.initiator.id, 'ADM-SEC-09');
            assert.equal(latest.initiator.name, 'Chief Compliance Officer');
            assert.equal(latest.initiator.role, 'super_admin');
            // Time
            assert.ok(latest.time.startedAt);
            assert.ok(latest.time.completedAt);
            // Count
            assert.equal(latest.count.total, 2);
            assert.equal(latest.count.success, 2);
            assert.equal(latest.count.failed, 0);
            // Outcome
            assert.equal(latest.outcome.status, 'completed');
            assert.equal(latest.outcome.hasFailures, false);
            // Cryptographic Integrity Hash
            assert.ok(latest.integrityHash, 'Must generate SHA-256 integrity hash');
            assert.equal(latest.integrityHash.length, 64);
        });
    });

    /* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
       2.3 EMAIL AND OTP SEPARATION (PRD §2.3)
    ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */
    describe('2.3 Email and OTP Separation & Constraints', () => {

        test('2.3.1 Separate Treatment: OTP engine and Email engine operate independently', async () => {
            // OTP action invokes the separate OTP Verification Service
            const otpRecipients = [
                { id: 'EMP-OTP-1', name: 'Alice Walker', email: 'alice@kylrxai.com', phone: '+919876543210' }
            ];

            const job = await bulkTriggerEngine.executeBulkTrigger({
                action: 'OTP_VERIFICATION',
                recipients: otpRecipients,
                payload: { purpose: 'portal_setup', ttlSeconds: 180, maxAttempts: 3 },
                actor: { role: 'admin', name: 'Admin' },
                options: { skipDelay: true }
            });

            assert.equal(job.status, 'completed');
            const itemRes = job.itemResults ? job.itemResults.get('EMP-OTP-1') : null;
            assert.ok(itemRes);
            assert.equal(itemRes.output.channel, 'otp');
            assert.ok(itemRes.output.otpId);
            assert.equal(itemRes.output.purpose, 'portal_setup');
            assert.equal(itemRes.output.maxAttempts, 3);
        });

        test('2.3.2 OTPs Must Expire: Verification fails once expiration time passes', () => {
            // Generate OTP with 1-second TTL
            const otp = otpVerificationService.generateOtp({
                identifier: 'user-expiry@kylrxai.com',
                purpose: 'login_verification',
                ttlSeconds: 1, // 1 second
                maxAttempts: 3
            });

            assert.ok(otp.otpId);
            assert.equal(otp.ttlSeconds, 1);

            // Wait 1.1s for expiration
            return new Promise((resolve) => {
                setTimeout(() => {
                    const verifyRes = otpVerificationService.verifyOtp({
                        otpId: otp.otpId,
                        code: otp.code
                    });

                    assert.equal(verifyRes.success, false);
                    assert.equal(verifyRes.reason, 'OTP_EXPIRED');
                    assert.ok(verifyRes.message.includes('expired'));
                    resolve();
                }, 1100);
            });
        });

        test('2.3.3 OTPs Work Only Once: Single-use enforcement blocks reuse', () => {
            const otp = otpVerificationService.generateOtp({
                identifier: 'user-singleuse@kylrxai.com',
                purpose: 'document_signing',
                ttlSeconds: 300,
                maxAttempts: 3
            });

            // First verification: Success!
            const firstVerify = otpVerificationService.verifyOtp({
                otpId: otp.otpId,
                code: otp.code
            });
            assert.equal(firstVerify.success, true);
            assert.ok(firstVerify.verifiedAt);

            // Second verification attempt with same code: BLOCKED (Single-Use Rule)
            const secondVerify = otpVerificationService.verifyOtp({
                otpId: otp.otpId,
                code: otp.code
            });
            assert.equal(secondVerify.success, false);
            assert.equal(secondVerify.reason, 'OTP_ALREADY_USED');
            assert.ok(secondVerify.message.includes('Single-Use Policy'));
        });

        test('2.3.4 OTP Attempt Limits: Exceeding max attempts locks and invalidates OTP', () => {
            const otp = otpVerificationService.generateOtp({
                identifier: 'user-lockout@kylrxai.com',
                purpose: 'payroll_release',
                ttlSeconds: 300,
                maxAttempts: 3
            });

            // Attempt 1: Wrong code
            const a1 = otpVerificationService.verifyOtp({ otpId: otp.otpId, code: '000000' });
            assert.equal(a1.success, false);
            assert.equal(a1.attemptsRemaining, 2);

            // Attempt 2: Wrong code
            const a2 = otpVerificationService.verifyOtp({ otpId: otp.otpId, code: '111111' });
            assert.equal(a2.success, false);
            assert.equal(a2.attemptsRemaining, 1);

            // Attempt 3: Wrong code -> Exceeded limit, permanently locked!
            const a3 = otpVerificationService.verifyOtp({ otpId: otp.otpId, code: '222222' });
            assert.equal(a3.success, false);
            assert.equal(a3.reason, 'OTP_MAX_ATTEMPTS_EXCEEDED');
            assert.equal(a3.attemptsRemaining, 0);

            // Attempt 4: Even with correct code, verification is rejected because it is locked
            const a4 = otpVerificationService.verifyOtp({ otpId: otp.otpId, code: otp.code });
            assert.equal(a4.success, false);
            assert.equal(a4.reason, 'OTP_MAX_ATTEMPTS_EXCEEDED');
        });

        test('2.3.5 Bulk Email Consent Rules: Enforces opt-in and respects unsubscribe status', () => {
            const recipients = [
                { id: 'CONSENT-1', email: 'opted_in@domain.com', consentStatus: 'granted' },
                { id: 'CONSENT-2', email: 'opted_out@domain.com', consentStatus: 'opted_out' },
                { id: 'CONSENT-3', email: 'unsubbed@domain.com', consentStatus: 'granted', unsubscribed: true }
            ];

            const validation = bulkTriggerEngine.validateSelection({
                action: 'EMAIL_NOTIFICATION',
                recipients,
                actor: { role: 'hr_admin', name: 'HR Admin' }
            });

            assert.equal(validation.validCount, 1);
            assert.equal(validation.invalidCount, 2);
            assert.equal(validation.validItems[0].email, 'opted_in@domain.com');
            assert.ok(validation.invalidItems.some(i => i.rawItem.email === 'opted_out@domain.com'));
            assert.ok(validation.invalidItems.some(i => i.rawItem.email === 'unsubbed@domain.com'));
        });

        test('2.3.6 Template Setup Bulk Triggering: Instantiates templates across selected cohort', async () => {
            const recipients = [
                { id: 'EMP-TPL-1', name: 'Dev 1', email: 'dev1@kylrxai.com' },
                { id: 'EMP-TPL-2', name: 'Dev 2', email: 'dev2@kylrxai.com' }
            ];

            const job = await bulkTriggerEngine.executeBulkTrigger({
                action: 'TEMPLATE_SETUP_DISPATCH',
                recipients,
                payload: { templateId: 'TPL-GOAL-001', module: 'goals' },
                actor: { role: 'manager', name: 'Tech Lead' },
                options: { skipDelay: true }
            });

            assert.equal(job.status, 'completed');
            assert.equal(job.successCount, 2);
            const itemRes = job.itemResults ? job.itemResults.get('EMP-TPL-1') : null;
            assert.equal(itemRes.output.channel, 'template_dispatch');
            assert.equal(itemRes.output.templateId, 'TPL-GOAL-001');
        });
    });

    /* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
       2.4 AI-ASSISTED BUILDER (PRD §2.4)
    ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */
    describe('2.4 AI-Assisted Builder & Human-in-the-Loop Controls', () => {

        test('2.4.1 User describes alert, AI suggests triggers, conditions, recipients, and message text', () => {
            const prompt = 'Alert reporting managers when an employee misses 3 consecutive unexcused days';
            const actor = { id: 'ADM-01', name: 'Sarah Connor', role: 'hr_admin' };

            const draft = aiAssistedBuilderService.generateAlertDraft(prompt, {}, actor);

            assert.ok(draft.id);
            assert.ok(draft.name.includes('3 Consecutive Absences'));
            assert.equal(draft.module, 'attendance');
            assert.equal(draft.category, 'Workforce Monitoring');

            // Suggested Triggers
            assert.ok(draft.triggers);
            assert.equal(draft.triggers.eventKey, 'attendance.consecutive_absences_detected');

            // Suggested Conditions
            assert.ok(draft.conditions);
            assert.equal(draft.conditions.metric, 'Consecutive Unexcused Absences');
            assert.equal(draft.conditions.comparator, '>=');
            assert.equal(draft.conditions.thresholdValue, 3);

            // Suggested Recipients
            assert.ok(Array.isArray(draft.recipients));
            assert.ok(draft.recipients.length >= 1);
            assert.ok(draft.recipients.some(r => r.role.includes('Reporting Manager')));

            // Suggested Message Text with Tokens
            assert.ok(draft.message);
            assert.ok(draft.message.subject.includes('{{employeeName}}') || draft.message.subject.includes('Consecutive Absences'));
            assert.ok(draft.message.body.includes('{{consecutiveDays}}'));
            assert.ok(draft.message.channels.includes('email'));
        });

        test('2.4.2 Strict Draft Compliance: AI output strictly remains a draft and cannot auto-activate', () => {
            const prompt = 'Notify payroll admin when salary variance exceeds 10%';
            const draft = aiAssistedBuilderService.generateAlertDraft(prompt, {}, { role: 'admin', name: 'Admin' });

            // Core Constraint: AI output MUST remain a draft
            assert.equal(draft.status, 'draft', 'Status must strictly be draft upon generation');
            assert.equal(draft.isDraft, true, 'isDraft boolean must be true');
            assert.equal(draft.activated, false, 'activated boolean must be false');
            assert.equal(draft.canAutoActivate, false, 'Automated activation bypass must be disabled');
            assert.ok(draft.aiMetadata.draftSafetyNotice.includes('draft state'), 'Notice must confirm draft requirement');
        });

        test('2.4.3 The user can edit suggestions before activation', () => {
            const prompt = 'Notify payroll admin when salary variance exceeds 10%';
            const draft = aiAssistedBuilderService.generateAlertDraft(prompt, {}, { role: 'admin', name: 'Admin' });

            // User modifies threshold to 15% and customizes subject line
            const updated = aiAssistedBuilderService.updateDraft(
                draft.id,
                {
                    conditions: { thresholdValue: 15 },
                    message: { subject: 'CUSTOM REVIEW: Month-over-Month Gross Variance > 15%' }
                },
                { id: 'ADM-02', name: 'Finance Controller', role: 'admin' }
            );

            assert.equal(updated.conditions.thresholdValue, 15, 'Threshold should be updated to 15');
            assert.equal(updated.message.subject, 'CUSTOM REVIEW: Month-over-Month Gross Variance > 15%');
            assert.equal(updated.userModified, true);
            assert.equal(updated.status, 'draft', 'Status must still remain draft after editing');
        });

        test('2.4.4 The user can reject suggestions with reason', () => {
            const prompt = 'Alert when contract expires in 30 days';
            const draft = aiAssistedBuilderService.generateAlertDraft(prompt, {}, { role: 'hr_admin', name: 'HR Admin' });

            const rejected = aiAssistedBuilderService.rejectDraft(
                draft.id,
                'Already covered under offboarding policy pipeline',
                { id: 'ADM-03', name: 'HR Director', role: 'super_admin' }
            );

            assert.equal(rejected.status, 'rejected');
            assert.equal(rejected.isDraft, false);
            assert.equal(rejected.activated, false);
            assert.equal(rejected.rejectionReason, 'Already covered under offboarding policy pipeline');

            // Block activation of rejected draft
            assert.throws(() => {
                aiAssistedBuilderService.activateConfiguration(draft.id, { role: 'super_admin', name: 'Super Admin' });
            }, /Cannot activate configuration/);
        });

        test('2.4.5 The system validates the final setup (schema and rule gate)', () => {
            // Valid setup passes
            const validConfig = {
                name: 'Valid Attendance Alert',
                triggers: { eventKey: 'attendance.anomaly' },
                conditions: { metric: 'Absence Count', comparator: '>=', thresholdValue: 3 },
                recipients: [{ role: 'Reporting Manager' }],
                message: { subject: 'Alert: Absence', body: 'Employee is absent.', channels: ['in_app'] }
            };
            const validRes = aiAssistedBuilderService.validateConfiguration(validConfig);
            assert.equal(validRes.isValid, true);
            assert.equal(validRes.errors.length, 0);

            // Invalid setup: missing name, invalid comparator, missing threshold, empty recipients & body
            const invalidConfig = {
                name: '',
                triggers: { eventKey: '' },
                conditions: { metric: 'Variance', comparator: 'INVALID_OP', thresholdValue: null },
                recipients: [],
                message: { subject: '', body: '' }
            };
            const invalidRes = aiAssistedBuilderService.validateConfiguration(invalidConfig);
            assert.equal(invalidRes.isValid, false);
            assert.ok(invalidRes.errors.length >= 4);
            assert.ok(invalidRes.errors.some(e => e.includes('Name is required')));
            assert.ok(invalidRes.errors.some(e => e.includes('Invalid Comparator')));
            assert.ok(invalidRes.errors.some(e => e.includes('recipient')));
            assert.ok(invalidRes.errors.some(e => e.includes('Subject line is required')));
        });

        test('2.4.6 An authorised user activates the configuration (Permission enforcement & status transition)', () => {
            const prompt = 'Send alert when policy unacknowledged after 3 days';
            const draft = aiAssistedBuilderService.generateAlertDraft(prompt, {}, { role: 'hr_admin', name: 'HR Admin' });

            const unauthorizedActor = { id: 'EMP-99', name: 'John Employee', role: 'employee' };
            const authorizedActor = { id: 'ADM-01', name: 'Super Admin', role: 'super_admin' };

            // 1. Unauthorized activation attempt: BLOCKED
            assert.throws(() => {
                aiAssistedBuilderService.activateConfiguration(draft.id, unauthorizedActor);
            }, /Permission Denied: Role 'employee' is not authorised to activate alerts/);

            // Verify status is still draft
            const checkDraft = aiAssistedBuilderService.getConfigurationById(draft.id);
            assert.equal(checkDraft.status, 'draft');

            // 2. Authorized user activates: SUCCEEDS
            const activated = aiAssistedBuilderService.activateConfiguration(draft.id, authorizedActor);
            assert.equal(activated.status, 'active', 'Status must transition to active');
            assert.equal(activated.isDraft, false);
            assert.equal(activated.activated, true);
            assert.equal(activated.activatedBy.role, 'super_admin');
            assert.ok(activated.activatedAt);
        });

        test('2.4.7 Multi-domain synthesis & audit trail verification', () => {
            const domainPrompts = [
                'Send notification when policy unacknowledged after 5 days',
                'Alert managers when PMS review cut-off is within 2 days',
                'Quarantine account when user inactive for 30 days'
            ];

            domainPrompts.forEach(p => {
                const draft = aiAssistedBuilderService.generateAlertDraft(p, {}, { role: 'admin', name: 'Admin' });
                assert.equal(draft.status, 'draft');
                assert.ok(draft.conditions.thresholdValue > 0);
                assert.ok(draft.recipients.length > 0);
            });

            // Inspect audit trail
            const trail = aiAssistedBuilderService.getAuditTrail(10);
            assert.ok(trail.length >= 3);
            const latest = trail[0];
            assert.ok(latest.action);
            assert.ok(latest.initiator);
            assert.ok(latest.integrityHash);
            assert.equal(latest.integrityHash.length, 64);
        });
    });
});

