/**
 * tests/module-level-templates.test.mjs
 * 
 * Comprehensive Test Suite for:
 * 1.3 Module-level templates
 * 
 * Specification Requirements:
 * - Each module should have a template relevant to its purpose.
 * - A shared template may be provided by an administrator.
 * - Managers may create personal copies where permissions allow.
 * - Template status & Expected behaviour:
 *     Draft: Editable; not available for general use.
 *     Published: Available to permitted users.
 *     Archived: Retained for history; unavailable for new use.
 * - Template changes should be versioned. Existing records should not change unexpectedly when a template is updated.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const customTemplateEngine = require('../services/custom-template-engine');
const managerGoalsEngine = require('../services/manager-goals-engine');

/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
   SUITE 1: Module-Level Purpose-Built Templates
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */
test('1.3.1 Module Relevance - Each module has a template relevant to its purpose', async (t) => {

    await t.test('All enterprise modules have dedicated purpose-built templates', () => {
        const requiredModules = [
            'goals',
            'onboarding',
            'lifecycle',
            'exit',
            'attendance',
            'leave',
            'payroll',
            'pms',
            'recruitment',
            'compliance',
            'policy'
        ];

        const allTemplates = customTemplateEngine.listTemplates({ includeArchived: true });
        const availableModules = new Set(allTemplates.map(t => t.module.toLowerCase()));

        for (const mod of requiredModules) {
            assert.ok(
                availableModules.has(mod),
                `Module "${mod}" must have at least one dedicated template seeded.`
            );
        }
    });

    await t.test('Each module template reflects its operational purpose and domain fields', () => {
        // Attendance template checks
        const attTpl = customTemplateEngine.getTemplate('tpl_att_roster_regularization');
        assert.equal(attTpl.module, 'attendance');
        assert.ok(attTpl.permittedFields.some(f => f.fieldKey === 'gracePeriodMinutes'));
        assert.ok(attTpl.lockedFields.includes('statutoryMaxDailyHours'));

        // Leave template checks
        const leaveTpl = customTemplateEngine.getTemplate('tpl_leave_allocation_compoff');
        assert.equal(leaveTpl.module, 'leave');
        assert.ok(leaveTpl.permittedFields.some(f => f.fieldKey === 'maxConcurrentTeamLeavePercent'));

        // Payroll template checks
        const payTpl = customTemplateEngine.getTemplate('tpl_payroll_disbursement_audit');
        assert.equal(payTpl.module, 'payroll');
        assert.ok(payTpl.lockedFields.includes('pfStatutoryRatePercent'));

        // Compliance template checks
        const compTpl = customTemplateEngine.getTemplate('tpl_compliance_statutory_audit');
        assert.equal(compTpl.module, 'compliance');
        assert.ok(compTpl.lockedFields.includes('statutoryDueDateEPFO'));
    });
});

/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
   SUITE 2: Shared Templates Provided by Administrator
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */
test('1.3.2 Administrator Shared Templates', async (t) => {

    await t.test('Administrator can provide a shared template', () => {
        const adminActor = { name: 'Super Admin', role: 'super_admin' };
        const sharedTpl = customTemplateEngine.provideSharedTemplate({
            name: 'Enterprise Cloud Security & Zero-Trust Audit Standard',
            module: 'compliance',
            category: 'Cybersecurity',
            description: 'Global corporate compliance checklist provided by security administrator.',
            instructions: 'Audited quarterly across all engineering clusters.',
            permittedFields: [
                { fieldKey: 'auditScore', label: 'Minimum Passing Audit Score', defaultValue: 95 }
            ],
            lockedFields: ['module'],
            structure: {
                defaultTarget: 95,
                defaultUnit: '% Pass'
            }
        }, adminActor);

        assert.ok(sharedTpl.id);
        assert.equal(sharedTpl.scope, 'shared');
        assert.equal(sharedTpl.isShared, true);
        assert.equal(sharedTpl.providedByAdmin, true);
        assert.equal(sharedTpl.status, 'published');
    });

    await t.test('Non-administrator cannot provide shared templates without permissions', () => {
        const managerActor = { name: 'Regular Manager', role: 'manager' };
        assert.throws(() => {
            customTemplateEngine.provideSharedTemplate({
                name: 'Unauthorized Shared Template',
                module: 'goals'
            }, managerActor);
        }, /Permission Denied: Only administrators can provide shared templates/);
    });
});

/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
   SUITE 3: Manager Personal Copies
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */
test('1.3.3 Manager Personal Copies', async (t) => {

    await t.test('Manager can create a personal copy of an existing shared template', () => {
        const managerActor = { id: 'MGR-SARAH-CONNOR', name: 'Sarah Connor', role: 'manager' };
        const parentTpl = customTemplateEngine.getTemplate('tpl_goal_zerotrust');

        const personalCopy = customTemplateEngine.createPersonalCopy(parentTpl.id, managerActor, {
            name: 'Sarah Connor Personal Zero-Trust Playbook',
            instructions: 'Custom instructions for Sarah Connor engineering squad.'
        });

        assert.ok(personalCopy.id.startsWith('TPL-PERS-'), 'Personal template must have personal ID prefix');
        assert.equal(personalCopy.name, 'Sarah Connor Personal Zero-Trust Playbook');
        assert.equal(personalCopy.scope, 'personal');
        assert.equal(personalCopy.isPersonal, true);
        assert.equal(personalCopy.isShared, false);
        assert.equal(personalCopy.ownerId, 'MGR-SARAH-CONNOR');
        assert.equal(personalCopy.ownerName, 'Sarah Connor');
        assert.equal(personalCopy.parentTemplateId, parentTpl.id);
        assert.equal(personalCopy.parentTemplateVersion, parentTpl.version);
        assert.equal(personalCopy.status, 'draft', 'Personal copy defaults to draft for manager editing');

        // Verify history records the personal copy event
        assert.equal(personalCopy.history[0].action, 'personal_copy_created');
    });

    await t.test('Manager CANNOT create a personal copy if template permissions forbid it', () => {
        const managerActor = { id: 'MGR-JOHN-DOE', name: 'John Doe', role: 'manager' };
        // tpl_compliance_statutory_audit has allowPersonalCopies: false
        const compTpl = customTemplateEngine.getTemplate('tpl_compliance_statutory_audit');

        assert.throws(() => {
            customTemplateEngine.createPersonalCopy(compTpl.id, managerActor);
        }, /does not allow personal copies/);
    });

    await t.test('Unauthorized role (e.g. employee) cannot create personal copies', () => {
        const guestActor = { id: 'EMP-GUEST', name: 'Guest Employee', role: 'employee' };
        assert.throws(() => {
            customTemplateEngine.createPersonalCopy('tpl_goal_zerotrust', guestActor);
        }, /not permitted to create personal copies/);
    });
});

/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
   SUITE 4: Template Status & Expected Behaviour
   - Draft: Editable; not available for general use.
   - Published: Available to permitted users.
   - Archived: Retained for history; unavailable for new use.
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */
test('1.3.4 Template Status & Expected Behaviour', async (t) => {

    await t.test('Draft: Editable by creator/admin', () => {
        const creator = { id: 'MGR-JOHN-DOE', name: 'John Doe', role: 'manager' };
        const draftTpl = customTemplateEngine.createTemplate({
            name: 'Q4 Regional Expansion Draft',
            module: 'goals',
            status: 'draft',
            instructions: 'Original draft instructions'
        }, creator);

        assert.equal(draftTpl.status, 'draft');

        // Creator edits draft
        const edited = customTemplateEngine.updateTemplate(draftTpl.id, {
            instructions: 'Updated draft instructions for Q4 review'
        }, creator);

        assert.equal(edited.instructions, 'Updated draft instructions for Q4 review');
    });

    await t.test('Draft: NOT available for general use (blocked from general instantiation)', () => {
        const creator = { id: 'MGR-ALICE', name: 'Alice Smith', role: 'manager' };
        const otherUser = { id: 'MGR-BOB', name: 'Bob Jones', role: 'manager' };

        const draftTpl = customTemplateEngine.createTemplate({
            name: 'Private Staging Draft Strategy',
            module: 'goals',
            status: 'draft'
        }, creator);

        // General user attempts instantiation -> must be rejected
        assert.throws(() => {
            customTemplateEngine.instantiateTemplate(draftTpl.id, {}, otherUser);
        }, /in Draft status and is not available for general use/);

        // General template search with forGeneralUse: true hides draft from other users
        const generalList = customTemplateEngine.listTemplates({ forGeneralUse: true, role: 'manager', ownerId: 'MGR-BOB' });
        assert.ok(!generalList.some(t => t.id === draftTpl.id), 'Draft must not appear in general use listing');
    });

    await t.test('Published: Available to permitted users', () => {
        const pubTpl = customTemplateEngine.getTemplate('tpl_goal_zerotrust');
        assert.equal(pubTpl.status, 'published');

        const manager = { id: 'MGR-KAVITHA', name: 'Kavitha Menon', role: 'manager' };
        const record = customTemplateEngine.instantiateTemplate(pubTpl.id, {
            title: 'Kavitha Team Threat Hardening'
        }, manager);

        assert.ok(record.recordId);
        assert.equal(record.title, 'Kavitha Team Threat Hardening');
        assert.equal(record.templateId, pubTpl.id);
    });

    await t.test('Archived: Retained for history', () => {
        const adminActor = { name: 'Admin', role: 'hr_admin' };
        const tplToArchive = customTemplateEngine.createTemplate({
            name: 'Temporary Experiment Template',
            module: 'goals',
            status: 'published'
        }, adminActor);

        // Archive template
        const archived = customTemplateEngine.archiveTemplate(tplToArchive.id, adminActor, 'Sprint completed, deprecating template.');
        assert.equal(archived.status, 'archived');
        assert.ok(archived.archivedAt);

        // Must still be retrievable for historical audit
        const retrieved = customTemplateEngine.getTemplate(archived.id);
        assert.equal(retrieved.id, archived.id);
        assert.equal(retrieved.status, 'archived');

        // Exists in archived query
        const archivedList = customTemplateEngine.listTemplates({ status: 'archived', includeArchived: true });
        assert.ok(archivedList.some(t => t.id === archived.id), 'Archived template must be retained in history');
    });

    await t.test('Archived: Unavailable for new use (instantiation & personal copies blocked)', () => {
        const adminActor = { name: 'Admin', role: 'hr_admin' };
        const tpl = customTemplateEngine.createTemplate({
            name: 'Deprecated Policy Template',
            module: 'policy',
            status: 'published'
        }, adminActor);

        customTemplateEngine.archiveTemplate(tpl.id, adminActor, 'Deprecated by corporate directive.');

        // Instantiation must fail
        assert.throws(() => {
            customTemplateEngine.instantiateTemplate(tpl.id, {}, { name: 'Manager', role: 'manager' });
        }, /is Archived and unavailable for new use/);

        // Creating personal copy must fail
        assert.throws(() => {
            customTemplateEngine.createPersonalCopy(tpl.id, { name: 'Manager', role: 'manager' });
        }, /Cannot create personal copies of an Archived template/);

        // Creating manager goal from archived template must fail
        assert.throws(() => {
            managerGoalsEngine.createGoal({
                title: 'Goal from Archived Template',
                templateId: tpl.id
            }, { name: 'Manager', role: 'manager' });
        }, /Template is Archived/);
    });
});

/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
   SUITE 5: Versioning & Record Immutability
   "Template changes should be versioned. Existing records should not change unexpectedly when a template is updated"
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */
test('1.3.5 Template Versioning & Existing Records Immutability', async (t) => {

    await t.test('Template changes are versioned with chronological version snapshots', () => {
        const adminActor = { name: 'HR Admin', role: 'hr_admin' };
        const tpl = customTemplateEngine.createTemplate({
            name: 'Adaptive Cloud Engineering OKR',
            module: 'goals',
            status: 'published',
            version: 'v1.0',
            structure: {
                defaultTarget: 90,
                defaultUnit: '% Uptime'
            },
            instructions: 'Version 1.0 guidelines.'
        }, adminActor);

        assert.equal(tpl.version, 'v1.0');
        assert.equal(tpl.versions.length, 1);

        // Version bump to v2.0
        const v2 = customTemplateEngine.createTemplateVersion(tpl.id, {
            versionNumber: 'v2.0',
            structure: {
                defaultTarget: 99.99,
                defaultUnit: '% High Availability'
            },
            instructions: 'Version 2.0 updated enterprise guidelines.',
            changeNotes: 'Major revision for enterprise tier SLA.'
        }, adminActor);

        assert.equal(v2.version, 'v2.0');
        assert.equal(v2.versions.length, 2);
        assert.equal(v2.versions[0].versionNumber, 'v1.0');
        assert.equal(v2.versions[1].versionNumber, 'v2.0');
        assert.equal(v2.versions[1].structure.defaultTarget, 99.99);
    });

    await t.test('Existing records DO NOT change unexpectedly when a template is updated', () => {
        const adminActor = { name: 'Super Admin', role: 'super_admin' };

        // 1. Setup template in v1.0
        const baseTpl = customTemplateEngine.createTemplate({
            name: 'Incident Response MTTR Target Protocol',
            module: 'goals',
            status: 'published',
            version: 'v1.0',
            structure: {
                defaultTitle: 'P1 Incident MTTR Resolution',
                defaultTarget: 15,
                defaultUnit: 'Minutes',
                defaultOutcome: 'Sub-15 minute critical incident resolution'
            },
            instructions: 'Version 1.0 baseline criteria'
        }, adminActor);

        // 2. Manager creates Goal 1 from Template v1.0
        const managerActor = { id: 'MGR-DEV-LEAD', name: 'DevOps Lead', role: 'manager' };
        const goalV1 = managerGoalsEngine.createGoal({
            title: 'Q3 Incident Response MTTR',
            templateId: baseTpl.id,
            measurement: {
                method: 'unit',
                target: 15,
                unit: 'Minutes'
            }
        }, managerActor);

        // Instantiate general record from Template v1.0
        const recordV1 = customTemplateEngine.instantiateTemplate(baseTpl.id, {
            target: 15
        }, managerActor);

        // Validate v1 values
        assert.equal(goalV1.templateVersion, 'v1.0');
        assert.equal(goalV1.measurement.target, 15);
        assert.equal(recordV1.templateVersion, 'v1.0');
        assert.equal(recordV1.templateVersionSnapshot.structure.defaultTarget, 15);

        // 3. Template is updated to v2.0 with completely different targets and instructions
        customTemplateEngine.createTemplateVersion(baseTpl.id, {
            versionNumber: 'v2.0',
            structure: {
                defaultTitle: 'P1 Incident MTTR Ultra Resolution',
                defaultTarget: 5, // Cut down to 5 minutes!
                defaultUnit: 'Minutes',
                defaultOutcome: 'Extreme 5 minute automated healing'
            },
            instructions: 'Version 2.0 aggressive automated AI remediation',
            changeNotes: 'Upgraded to automated self-healing pipeline.'
        }, adminActor);

        // 4. VERIFY: Existing Goal 1 and Record 1 did NOT change!
        const fetchedGoalV1 = managerGoalsEngine.getGoal(goalV1.id);
        assert.equal(fetchedGoalV1.measurement.target, 15, 'Existing goal target MUST NOT change when template updates');
        assert.equal(fetchedGoalV1.templateVersion, 'v1.0', 'Existing goal must retain reference to v1.0');
        assert.equal(fetchedGoalV1.templateSnapshot.version, 'v1.0', 'Existing goal templateSnapshot must remain frozen at v1.0');

        assert.equal(recordV1.templateVersion, 'v1.0');
        assert.equal(recordV1.templateVersionSnapshot.structure.defaultTarget, 15);

        // 5. Manager creates Goal 2 from Template (now v2.0)
        const goalV2 = managerGoalsEngine.createGoal({
            title: 'Q4 Automated Incident Response MTTR',
            templateId: baseTpl.id,
            measurement: {
                method: 'unit',
                target: 5,
                unit: 'Minutes'
            }
        }, managerActor);

        const recordV2 = customTemplateEngine.instantiateTemplate(baseTpl.id, {
            target: 5
        }, managerActor);

        // 6. Assert both records coexist independently with their respective frozen snapshots
        assert.equal(goalV2.templateVersion, 'v2.0');
        assert.equal(goalV2.measurement.target, 5);
        assert.equal(recordV2.templateVersion, 'v2.0');
        assert.equal(recordV2.templateVersionSnapshot.structure.defaultTarget, 5);

        // Re-confirm Goal 1 is still completely unchanged
        assert.equal(fetchedGoalV1.measurement.target, 15);
        assert.equal(fetchedGoalV1.templateVersion, 'v1.0');
    });
});
