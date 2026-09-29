import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import alertRegistryService from '../services/alert-trigger-registry-service.js';
import clientAlertRegistry from '../alert-trigger-registry.js';

describe('PRD Section 11: Alert Monitor Interface & Safe AI Simulation Sandbox Suite', () => {

    test('1. Trigger Registry contains all canonical Enterprise Event Keys with Human-Readable Descriptions', () => {
        const triggers = alertRegistryService.getAllTriggers();
        assert.ok(triggers.length >= 6, 'Registry should have at least 6 canonical enterprise triggers');

        const expectedKeys = [
            'EVT_ABSENCE_EXCEEDED',
            'EVT_PROBATION_EXPIRY',
            'EVT_RETENTION_1YR_WARNING',
            'EVT_PAYROLL_SPIKE',
            'EVT_POLICY_UNACKED',
            'EVT_EXIT_PENDING'
        ];

        expectedKeys.forEach(key => {
            const trigger = alertRegistryService.getTriggerByKey(key);
            assert.ok(trigger, `Trigger ${key} must exist in registry`);
            assert.ok(trigger.displayName && trigger.displayName.length > 5, `Trigger ${key} must have clear display name`);
            assert.ok(trigger.description && trigger.description.length > 20, `Trigger ${key} must have human-readable description`);
            assert.ok(trigger.category, `Trigger ${key} must have category`);
            assert.ok(Array.isArray(trigger.parameters) && trigger.parameters.length > 0, `Trigger ${key} must specify parameters`);
            assert.ok(trigger.sampleMockPayload && typeof trigger.sampleMockPayload === 'object', `Trigger ${key} must provide sample mock payload`);
            assert.ok(trigger.sampleDenialPayload && typeof trigger.sampleDenialPayload === 'object', `Trigger ${key} must provide sample denial payload`);
            assert.ok(trigger.routing && Array.isArray(trigger.routing.primaryRecipients), `Trigger ${key} must define primary recipients`);
            assert.ok(trigger.routing.channels && Array.isArray(trigger.routing.channels), `Trigger ${key} must define routing channels`);
        });
    });

    test('2. Safe AI Simulation Sandbox: Consecutive Absence Limit Exceeded (EVT_ABSENCE_EXCEEDED) Breach Simulation', async () => {
        const mockPayload = {
            employeeId: 'EMP0102',
            employeeName: 'Rahul Sharma',
            consecutiveDays: 4,
            reportingManagerId: 'MGR004',
            department: 'Core Engineering'
        };

        const result = await alertRegistryService.runSandboxedDryRun('EVT_ABSENCE_EXCEEDED', mockPayload);

        assert.strictEqual(result.success, true);
        assert.strictEqual(result.eventKey, 'EVT_ABSENCE_EXCEEDED');
        assert.strictEqual(result.conditionMet, true, '4 days consecutive absence must breach >= 3 days threshold');
        assert.strictEqual(result.verdict, 'ALERT_TRIGGERED');

        // Verify Sandboxed Dry-Run Guarantee
        assert.ok(result.dryRunGuarantee, 'Result must contain dry-run guarantee certificate');
        assert.strictEqual(result.dryRunGuarantee.certifiedSafe, true);
        assert.strictEqual(result.dryRunGuarantee.firestoreWrites, 0, 'Must have ZERO Firestore writes in simulation');
        assert.strictEqual(result.dryRunGuarantee.employeeStatusModified, false, 'Must NOT modify employee status');
        assert.strictEqual(result.dryRunGuarantee.emailsSent, 0, 'Must NOT dispatch real emails');
        assert.strictEqual(result.dryRunGuarantee.webhooksFired, 0, 'Must NOT trigger live external webhooks');

        // Verify Stage-by-Stage Trace
        assert.ok(Array.isArray(result.trace), 'Trace must be an array of stages');
        assert.ok(result.trace.length >= 6, 'Must generate at least 6 stages of execution trace');

        const stageNames = result.trace.map(s => s.stage);
        assert.ok(stageNames.some(s => s.includes('STAGE 1: TRIGGER RECEIVED')));
        assert.ok(stageNames.some(s => s.includes('STAGE 2: PARAMETER EXTRACTION')));
        assert.ok(stageNames.some(s => s.includes('STAGE 3: THRESHOLD EVALUATION')));
        assert.ok(stageNames.some(s => s.includes('STAGE 4: SIMULATED ROUTING PATH')));
        assert.ok(stageNames.some(s => s.includes('STAGE 5: SLA TIMER & ESCALATION VALIDATION')));
        assert.ok(stageNames.some(s => s.includes('STAGE 6: MOCK ACTION DISPATCH')));
    });

    test('3. Safe AI Simulation Sandbox: Consecutive Absence Condition Denial (Safe Under Threshold)', async () => {
        const mockPayload = {
            employeeId: 'EMP0102',
            employeeName: 'Rahul Sharma',
            consecutiveDays: 2, // Less than threshold 3
            reportingManagerId: 'MGR004'
        };

        const result = await alertRegistryService.runSandboxedDryRun('EVT_ABSENCE_EXCEEDED', mockPayload);

        assert.strictEqual(result.success, true);
        assert.strictEqual(result.conditionMet, false, '2 days consecutive absence must NOT breach >= 3 threshold');
        assert.strictEqual(result.verdict, 'ALERT_SUPPRESSED');

        const thresholdStage = result.trace.find(s => s.stage.includes('STAGE 3'));
        assert.ok(thresholdStage);
        assert.strictEqual(thresholdStage.status, 'CONDITION_DENIED');

        const routingStage = result.trace.find(s => s.stage.includes('STAGE 4'));
        assert.ok(routingStage);
        assert.strictEqual(routingStage.status, 'BYPASSED');
    });

    test('4. Safe AI Simulation Sandbox: Payroll Variance Anomaly Exceeded (EVT_PAYROLL_SPIKE) Breach & Denial', async () => {
        const breachPayload = {
            batchId: 'BATCH-SEP-2026',
            cycleMonth: 'September 2026',
            variancePercentage: 14.8, // > 10%
            affectedHeadcount: 142,
            totalGross: 9850000
        };

        const breachResult = await alertRegistryService.runSandboxedDryRun('EVT_PAYROLL_SPIKE', breachPayload);
        assert.strictEqual(breachResult.conditionMet, true);
        assert.strictEqual(breachResult.verdict, 'ALERT_TRIGGERED');
        assert.strictEqual(breachResult.dryRunGuarantee.certifiedSafe, true);

        const safePayload = {
            batchId: 'BATCH-SEP-2026',
            cycleMonth: 'September 2026',
            variancePercentage: 4.2, // <= 10%
            affectedHeadcount: 142,
            totalGross: 8650000
        };

        const safeResult = await alertRegistryService.runSandboxedDryRun('EVT_PAYROLL_SPIKE', safePayload);
        assert.strictEqual(safeResult.conditionMet, false);
        assert.strictEqual(safeResult.verdict, 'ALERT_SUPPRESSED');
    });

    test('5. Safe AI Simulation Sandbox: Exit Clearance 48h SLA Stagnation (EVT_EXIT_PENDING)', async () => {
        const payload = {
            resignationId: 'SEP-2026-089',
            employeeId: 'EMP0054',
            employeeName: 'Vikram Joshi',
            departmentPending: 'IT Asset Return',
            pendingDurationHours: 54, // >= 48h
            responsiblePersonId: 'EMP-IT-002'
        };

        const result = await alertRegistryService.runSandboxedDryRun('EVT_EXIT_PENDING', payload);
        assert.strictEqual(result.conditionMet, true);
        assert.strictEqual(result.verdict, 'ALERT_TRIGGERED');

        const slaStage = result.trace.find(s => s.stage.includes('STAGE 5'));
        assert.ok(slaStage);
        assert.ok(slaStage.details.includes('12h SLA timeout'));
        assert.strictEqual(slaStage.status, 'SLA_SCHEDULED');
    });

    test('6. Client-Side Controller (`alert-trigger-registry.js`) parity and exports', () => {
        assert.ok(clientAlertRegistry, 'Client alert registry module must be defined');
        assert.ok(typeof clientAlertRegistry.getAllTriggers === 'function');
        assert.ok(typeof clientAlertRegistry.getTriggerByKey === 'function');
        assert.ok(typeof clientAlertRegistry.renderAlertMonitorCards === 'function');
        assert.ok(typeof clientAlertRegistry.openSetupGuide === 'function');
        assert.ok(typeof clientAlertRegistry.closeSetupGuideDrawer === 'function');
        assert.ok(typeof clientAlertRegistry.openAiSimulation === 'function');
        assert.ok(typeof clientAlertRegistry.closeAiSimulationModal === 'function');
        assert.ok(typeof clientAlertRegistry.executeSimulation === 'function');
        assert.ok(typeof clientAlertRegistry.loadSimPreset === 'function');

        const clientTriggers = clientAlertRegistry.getAllTriggers();
        assert.strictEqual(clientTriggers.length, 6);
        assert.ok(clientAlertRegistry.getTriggerByKey('EVT_PROBATION_EXPIRY'));
    });

    test('7. HTML & DOM Verification: `admin-alert-builder.html` includes all required components', () => {
        const htmlPath = path.resolve('admin-alert-builder.html');
        const html = fs.readFileSync(htmlPath, 'utf8');

        // Required PRD §11 Element IDs
        const requiredIds = [
            'alertSetupGuideDrawer',
            'alertSetupGuideOverlay',
            'setupGuideContent',
            'aiSimulationSandboxModal',
            'simModalTriggerSelect',
            'simModalTriggerDesc',
            'simModalPayloadInput',
            'simTraceTerminal',
            'btnRunSim',
            'viewTabRegistry',
            'viewTabCustom',
            'registryFilterBar',
            'alertCardsContainer'
        ];

        requiredIds.forEach(id => {
            assert.ok(html.includes(`id="${id}"`), `admin-alert-builder.html must contain element with id="${id}"`);
        });

        // Script Inclusion
        assert.ok(html.includes('src="alert-trigger-registry.js"'), 'Must load alert-trigger-registry.js');

        // Setup Guide & AI Simulation Action Buttons
        assert.ok(html.includes('openSetupGuide()'), 'Must have button calling openSetupGuide()');
        assert.ok(html.includes('openAiSimulation()'), 'Must have button calling openAiSimulation()');

        // Dry-Run Guarantee messaging in modal
        assert.ok(html.includes('DRY-RUN GUARANTEE'), 'Modal must prominently display DRY-RUN GUARANTEE badge');
    });

    test('8. Firestore Security Rules: `firestore.rules` grants protected access to `alert_trigger_registry`', () => {
        const rulesPath = path.resolve('firestore.rules');
        const rules = fs.readFileSync(rulesPath, 'utf8');

        assert.ok(rules.includes('match /alert_trigger_registry/{triggerId}'), 'firestore.rules must match alert_trigger_registry collection');
        assert.ok(rules.includes('allow read: if signedIn()'), 'Read rule must be enabled for signed-in users');
        assert.ok(rules.includes('allow write: if canAccessAdmin() || isStaff()'), 'Write rule must require admin or staff privileges');
    });
});
