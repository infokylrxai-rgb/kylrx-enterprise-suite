/**
 * tests/manager-goals-and-custom-templates.test.mjs
 * 
 * Comprehensive Test Suite for:
 * 1. Manager Goals and Template Configuration
 * 1.1 Manager Goal Management
 * 1.2 Customisable Templates
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const managerGoalsEngine = require('../services/manager-goals-engine');
const customTemplateEngine = require('../services/custom-template-engine');

/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
   1.1 MANAGER GOAL MANAGEMENT TEST SUITE
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */

test('1.1 Manager Goal Management - Core Capabilities', async (t) => {

    await t.test('1.1.1 Create: Manager can add a goal with title, description, outcome, and owner', () => {
        const actor = {
            id: 'MGR-JOHN-DOE',
            name: 'John Doe',
            role: 'Cybersecurity Manager',
            email: 'john.doe@kylrx.com'
        };

        const newGoal = managerGoalsEngine.createGoal({
            title: 'Cloud Security Telemetry Centralization',
            description: 'Unify SIEM pipelines across AWS and GCP infrastructure into single pane of glass.',
            outcome: 'Sub-minute alert correlation with zero missed P1 intrusion detections.',
            category: 'Cybersecurity & Compliance',
            measurement: {
                method: 'quantitative',
                target: 100,
                unit: '% Ingestion',
                completionCriteria: 'All 4 enterprise clusters emit audit telemetry with SHA-256 integrity signatures.'
            },
            schedule: {
                startDate: '2026-10-18',
                targetCompletionDate: '2026-12-31'
            }
        }, actor);

        assert.ok(newGoal.id, 'Goal must have a unique ID');
        assert.equal(newGoal.title, 'Cloud Security Telemetry Centralization');
        assert.equal(newGoal.outcome, 'Sub-minute alert correlation with zero missed P1 intrusion detections.');
        assert.equal(newGoal.owner.name, 'John Doe');
        assert.equal(newGoal.owner.role, 'Cybersecurity Manager');
        assert.equal(newGoal.status, 'active');
        assert.equal(newGoal.progress, 0);

        // Verify creation history
        assert.ok(newGoal.history.length >= 1, 'Initial creation must be recorded in history');
        assert.equal(newGoal.history[0].action, 'created');
        assert.equal(newGoal.history[0].actor.name, 'John Doe');
    });

    await t.test('1.1.2 Measure: Goals can include target, unit, milestone or completion criteria', () => {
        const goal = managerGoalsEngine.createGoal({
            title: 'Vulnerability Remediation Sprint',
            description: 'Fix all critical CVEs in production containers',
            outcome: 'Zero critical CVEs remaining in production',
            category: 'Operational Excellence',
            measurement: {
                method: 'milestone',
                target: 3,
                current: 0,
                unit: 'Milestones',
                completionCriteria: 'Third-party scanner certifies 0 critical vulnerabilities.',
                milestones: [
                    { id: 'm1', title: 'Patch base OS container images', completed: false },
                    { id: 'm2', title: 'Upgrade third-party npm packages', completed: false },
                    { id: 'm3', title: 'Re-run automated Trivy security scans', completed: false }
                ]
            },
            schedule: {
                startDate: '2026-10-18',
                targetCompletionDate: '2026-11-15'
            }
        });

        assert.equal(goal.measurement.target, 3);
        assert.equal(goal.measurement.unit, 'Milestones');
        assert.equal(goal.measurement.completionCriteria, 'Third-party scanner certifies 0 critical vulnerabilities.');
        assert.equal(goal.measurement.milestones.length, 3);

        // Toggle milestone and verify auto progress recalculation
        const updated = managerGoalsEngine.toggleMilestone(goal.id, 'm1');
        assert.equal(updated.measurement.milestones[0].completed, true);
        assert.equal(updated.measurement.current, 1);
        assert.equal(updated.progress, 33);

        // Toggle remaining milestones to complete goal
        managerGoalsEngine.toggleMilestone(goal.id, 'm2');
        const completedGoal = managerGoalsEngine.toggleMilestone(goal.id, 'm3');
        assert.equal(completedGoal.progress, 100);
        assert.equal(completedGoal.status, 'completed');
    });

    await t.test('1.1.3 Schedule: Start date and target completion date are recorded', () => {
        const goal = managerGoalsEngine.createGoal({
            title: 'Schedule Validation Goal',
            description: 'Validating start and target dates',
            schedule: {
                startDate: '2026-11-01',
                targetCompletionDate: '2026-11-30'
            }
        });

        assert.equal(goal.schedule.startDate, '2026-11-01');
        assert.equal(goal.schedule.targetCompletionDate, '2026-11-30');
    });

    await t.test('1.1.4 Track: Managers can update progress, current metric value, and status', () => {
        const goal = managerGoalsEngine.createGoal({
            title: 'Telemetry Pipeline Tuning',
            measurement: { method: 'quantitative', target: 100, unit: '%' }
        });

        const actor = { name: 'John Doe', role: 'Cybersecurity Manager' };
        const updated = managerGoalsEngine.updateProgress(goal.id, 65, 'Phase 1 verification complete', actor, 65);

        assert.equal(updated.progress, 65);
        assert.equal(updated.measurement.current, 65);

        // Check history entry
        const latestHistory = updated.history[updated.history.length - 1];
        assert.equal(latestHistory.action, 'progress_updated');
        assert.equal(latestHistory.notes, 'Phase 1 verification complete');
        assert.equal(latestHistory.previousState.progress, 0);
        assert.equal(latestHistory.newState.progress, 65);
    });

    await t.test('1.1.5 Manage: Goals can be edited, paused, resumed, completed, or archived', () => {
        const actor = { name: 'John Doe', role: 'Cybersecurity Manager' };
        const goal = managerGoalsEngine.createGoal({
            title: 'Lifecycle State Goal',
            description: 'Testing edit, pause, resume, complete, archive'
        }, actor);

        // Edit
        const edited = managerGoalsEngine.updateGoal(goal.id, {
            title: 'Lifecycle State Goal (Revised)',
            category: 'Innovation'
        }, actor);
        assert.equal(edited.title, 'Lifecycle State Goal (Revised)');
        assert.equal(edited.category, 'Innovation');

        // Pause
        const paused = managerGoalsEngine.pauseGoal(goal.id, 'Waiting for hardware shipment', actor);
        assert.equal(paused.status, 'paused');

        // Resume
        const resumed = managerGoalsEngine.resumeGoal(goal.id, actor);
        assert.equal(resumed.status, 'active');

        // Complete
        const completed = managerGoalsEngine.completeGoal(goal.id, 'Delivered ahead of schedule', actor);
        assert.equal(completed.status, 'completed');
        assert.equal(completed.progress, 100);

        // Archive
        const archived = managerGoalsEngine.archiveGoal(goal.id, actor);
        assert.equal(archived.status, 'archived');
    });

    await t.test('1.1.6 History: The system records creation and all subsequent changes in chronological audit trail', () => {
        const actor = { name: 'John Doe', role: 'Cybersecurity Manager' };
        const goal = managerGoalsEngine.createGoal({
            title: 'Full Audit Trail Test Goal',
            description: 'Validating history array integrity'
        }, actor);

        managerGoalsEngine.updateGoal(goal.id, { description: 'Updated description' }, actor);
        managerGoalsEngine.updateProgress(goal.id, 40, 'Midpoint milestone reached', actor);
        managerGoalsEngine.pauseGoal(goal.id, 'Sprint dependency blocked', actor);
        managerGoalsEngine.resumeGoal(goal.id, actor);
        managerGoalsEngine.addCheckInNote(goal.id, 'Weekly standup review completed', actor);

        const history = managerGoalsEngine.getGoalHistory(goal.id);
        assert.ok(history.length >= 6, `Expected at least 6 audit trail entries, found ${history.length}`);
        
        // Assert every history entry contains required audit properties
        for (const entry of history) {
            assert.ok(entry.timestamp, 'History entry must have timestamp');
            assert.ok(entry.action, 'History entry must have action');
            assert.ok(entry.summary, 'History entry must have summary');
            assert.ok(entry.actor, 'History entry must have actor');
        }
    });
});

/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
   1.2 CUSTOMISABLE TEMPLATES TEST SUITE
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */

test('1.2 Customisable Templates - Core Capabilities', async (t) => {

    await t.test('1.2.1 Module Structure: Applicable modules provide suitable template structures', () => {
        const templates = customTemplateEngine.listTemplates();
        assert.ok(templates.length >= 5, 'Must provide templates across modules');

        const modules = new Set(templates.map(t => t.module));
        assert.ok(modules.has('goals'), 'Must provide goal templates');
        assert.ok(modules.has('onboarding'), 'Must provide onboarding templates');
        assert.ok(modules.has('lifecycle'), 'Must provide lifecycle templates');
        assert.ok(modules.has('exit'), 'Must provide exit templates');

        for (const tpl of templates) {
            assert.ok(tpl.id, 'Template must have ID');
            assert.ok(tpl.name, 'Template must have Name');
            assert.ok(tpl.module, 'Template must have Module');
            assert.ok(Array.isArray(tpl.permittedFields), 'Template must define permittedFields');
            assert.ok(Array.isArray(tpl.lockedFields), 'Template must define lockedFields');
            assert.ok(tpl.instructions, 'Template must provide user instructions');
            assert.ok(tpl.status === 'published' || tpl.status === 'draft', 'Status must be draft or published');
        }
    });

    await t.test('1.2.2 Choose: Users can choose an existing template to instantiate', () => {
        const goalTemplates = customTemplateEngine.listTemplates({ module: 'goals', status: 'published' });
        assert.ok(goalTemplates.length >= 1, 'Must find published goal templates');

        const chosen = goalTemplates[0];
        const instantiated = customTemplateEngine.instantiateTemplate(chosen.id, {
            title: 'Customized Zero-Trust Rollout',
            target: 99.99
        }, { name: 'John Doe', role: 'manager' });

        assert.equal(instantiated.title, 'Customized Zero-Trust Rollout');
        assert.equal(instantiated.measurement.target, 99.99);
        assert.equal(instantiated.templateId, chosen.id);
    });

    await t.test('1.2.3 Create: Authorised users can create new templates', () => {
        const adminActor = { name: 'HR Director', role: 'hr_admin' };
        const newTemplate = customTemplateEngine.createTemplate({
            name: 'Cloud Security Compliance Quarterly Sprint',
            module: 'goals',
            category: 'Cybersecurity & Compliance',
            description: 'Quarterly compliance checklist template for security managers.',
            instructions: 'Managers customize the target certification count and delivery dates.',
            permittedFields: [
                { fieldKey: 'title', label: 'Goal Title', isPermittedToEdit: true },
                { fieldKey: 'target', label: 'Target Audits', isPermittedToEdit: true, defaultValue: 4 },
                { fieldKey: 'complianceStandard', label: 'Compliance Standard', isPermittedToEdit: false, defaultValue: 'ISO-27001' }
            ],
            lockedFields: ['complianceStandard'],
            status: 'draft'
        }, adminActor);

        assert.ok(newTemplate.id);
        assert.equal(newTemplate.name, 'Cloud Security Compliance Quarterly Sprint');
        assert.equal(newTemplate.status, 'draft');
        assert.equal(newTemplate.permittedFields.length, 3);
        assert.ok(newTemplate.lockedFields.includes('complianceStandard'));

        // Non-authorised role check
        assert.throws(() => {
            customTemplateEngine.createTemplate({
                name: 'Unauthorized Template',
                module: 'goals'
            }, { name: 'Guest', role: 'guest_employee' });
        }, /not authorized/);
    });

    await t.test('1.2.4 Edit: Users can edit permitted fields and instructions while locked fields are protected', () => {
        const tpl = customTemplateEngine.getTemplate('tpl_goal_zerotrust');
        
        // Update permitted fields and instructions
        const updated = customTemplateEngine.updateTemplate(tpl.id, {
            instructions: 'Revised: Please ensure target compliance is set above 98% before submitting.',
            permittedFields: tpl.permittedFields.map(f => {
                if (f.fieldKey === 'target') return { ...f, defaultValue: 99.95 };
                return f;
            })
        }, { name: 'John Doe', role: 'manager' });

        assert.equal(updated.instructions, 'Revised: Please ensure target compliance is set above 98% before submitting.');
        const targetField = updated.permittedFields.find(f => f.fieldKey === 'target');
        assert.equal(targetField.defaultValue, 99.95);

        // Attempt to tamper with locked fields during instantiation should fail
        assert.throws(() => {
            customTemplateEngine.instantiateTemplate(tpl.id, {
                departmentCode: 'TAMPERED-DEPT-999' // departmentCode is in lockedFields
            }, { name: 'Standard Manager', role: 'manager' });
        }, /Permission Denied.*locked/);
    });

    await t.test('1.2.5 Preview: A preview appears before saving', () => {
        const tpl = customTemplateEngine.getTemplate('tpl_goal_zerotrust');
        const preview = customTemplateEngine.previewTemplate(tpl.id, {
            title: 'Previewed Zero-Trust Sprint Target',
            target: 99.95,
            completionCriteria: 'Passes automated pen-testing.'
        });

        assert.ok(preview.previewHtml, 'Preview must generate formatted HTML');
        assert.ok(preview.previewHtml.includes('Previewed Zero-Trust Sprint Target'), 'HTML must reflect custom preview values');
        assert.ok(preview.previewHtml.includes('99.95'), 'HTML must reflect custom target value');
        assert.equal(preview.mergedFields.title, 'Previewed Zero-Trust Sprint Target');
    });

    await t.test('1.2.6 Draft / Publish: Templates can be saved as drafts or published', () => {
        const tpl = customTemplateEngine.getTemplate('tpl_goal_ai_automation');
        assert.equal(tpl.status, 'draft', 'Template starts in draft state');

        // Save as draft
        customTemplateEngine.saveAsDraft(tpl.id, { instructions: 'Updated draft instructions' }, { name: 'Admin', role: 'hr_admin' });
        assert.equal(tpl.status, 'draft');

        // Publish
        const published = customTemplateEngine.publishTemplate(tpl.id, { name: 'Admin', role: 'hr_admin' });
        assert.equal(published.status, 'published');
        assert.ok(published.publishedAt, 'Published template must have publishedAt timestamp');
    });

    await t.test('1.2.7 Permissions: Administrators can manage template permissions', () => {
        const tpl = customTemplateEngine.getTemplate('tpl_goal_zerotrust');

        // Non-admin cannot change permissions
        assert.throws(() => {
            customTemplateEngine.updateTemplatePermissions(tpl.id, {
                permittedRoles: ['manager']
            }, { name: 'Regular User', role: 'employee' });
        }, /Access Denied: Only Administrators can manage template permissions/);

        // Administrator successfully updates permissions
        const updated = customTemplateEngine.updateTemplatePermissions(tpl.id, {
            permittedRoles: ['super_admin', 'hr_admin', 'manager'],
            permittedModules: ['goals', 'pms', 'hr_admin', 'security'],
            lockedFields: ['departmentCode', 'corporateEntity', 'auditComplianceOfficer']
        }, { name: 'Super Admin', role: 'super_admin' });

        assert.ok(updated.permissions.permittedModules.includes('security'));
        assert.ok(updated.lockedFields.includes('auditComplianceOfficer'));

        // Verify permission change was recorded in template history
        const latestHistory = updated.history[updated.history.length - 1];
        assert.equal(latestHistory.action, 'permissions_updated');
    });
});
