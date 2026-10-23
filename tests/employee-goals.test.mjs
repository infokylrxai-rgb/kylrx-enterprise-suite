/**
 * tests/employee-goals.test.mjs
 * 
 * Comprehensive Test Suite for:
 * 1.1 Employee Goal Management
 * 
 * Verifies:
 * • Create: Employees can add a goal with title, description, outcome, and owner.
 * • Measure: Goals can include a target, unit, milestone or completion criteria.
 * • Schedule: Start date and target completion date can be recorded.
 * • Track: Employees can update progress and status.
 * • Manage: Goals can be edited, paused, completed or archived.
 * • History: The system records creation and subsequent changes in an immutable audit trail.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const employeeGoalsEngine = require('../services/employee-goals-engine');

/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
   1.1 EMPLOYEE GOAL MANAGEMENT TEST SUITE
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */

test('1.1 Employee Goal Management - Core Capabilities', async (t) => {

    await t.test('1.1.1 Create: Employee can add a goal with title, description, outcome, and owner', () => {
        const actor = {
            id: 'EMP-MARRY-DOE',
            name: 'Marry Doe',
            role: 'Senior Software Engineer',
            email: 'marry.doe@kylrx.com'
        };

        const newGoal = employeeGoalsEngine.createGoal({
            title: 'Sub-second Full-text Search Indexing Engine',
            description: 'Implement distributed Elasticsearch indices with zero query downtime.',
            outcome: 'P95 search latency reduced to under 120ms with 100% indexing uptime.',
            category: 'Technical Excellence',
            measurement: {
                method: 'quantitative',
                target: 120,
                unit: 'ms (p95)',
                completionCriteria: 'Stress tests confirm p95 sub-120ms with zero index drift.'
            },
            schedule: {
                startDate: '2026-10-22',
                targetCompletionDate: '2026-12-31'
            }
        }, actor);

        assert.ok(newGoal.id, 'Goal must have a unique ID');
        assert.ok(newGoal.id.startsWith('EMP-GOAL-'), 'Goal ID must start with EMP-GOAL-');
        assert.equal(newGoal.title, 'Sub-second Full-text Search Indexing Engine');
        assert.equal(newGoal.outcome, 'P95 search latency reduced to under 120ms with 100% indexing uptime.');
        assert.equal(newGoal.owner.name, 'Marry Doe');
        assert.equal(newGoal.owner.role, 'Senior Software Engineer');
        assert.equal(newGoal.status, 'active');
        assert.equal(newGoal.progress, 0);

        // Verify creation history
        assert.ok(newGoal.history.length >= 1, 'Initial creation must be recorded in history');
        assert.equal(newGoal.history[0].action, 'created');
        assert.equal(newGoal.history[0].actor.name, 'Marry Doe');
    });

    await t.test('1.1.2 Measure: Goals can include target, unit, milestone or completion criteria', () => {
        const goal = employeeGoalsEngine.createGoal({
            title: 'GraphQL API Federation Sprint',
            description: 'Federate schemas across microservices',
            outcome: 'Unified GraphQL gateway operational',
            category: 'Technical Excellence',
            measurement: {
                method: 'milestone',
                target: 3,
                current: 0,
                unit: 'Milestones',
                completionCriteria: 'All 3 subgraphs pass Apollo federation validation test suite.',
                milestones: [
                    { id: 'm1', title: 'Define supergraph schema and federated directives', completed: false },
                    { id: 'm2', title: 'Implement Apollo Router gateway container', completed: false },
                    { id: 'm3', title: 'End-to-end integration and query latency verification', completed: false }
                ]
            },
            schedule: {
                startDate: '2026-10-22',
                targetCompletionDate: '2026-11-30'
            }
        });

        assert.equal(goal.measurement.target, 3);
        assert.equal(goal.measurement.unit, 'Milestones');
        assert.equal(goal.measurement.completionCriteria, 'All 3 subgraphs pass Apollo federation validation test suite.');
        assert.equal(goal.measurement.milestones.length, 3);

        // Toggle milestone and verify auto progress recalculation
        const updated = employeeGoalsEngine.toggleMilestone(goal.id, 'm1');
        assert.equal(updated.measurement.milestones[0].completed, true);
        assert.equal(updated.measurement.current, 1);
        assert.equal(updated.progress, 33);

        // Toggle remaining milestones to complete goal
        employeeGoalsEngine.toggleMilestone(goal.id, 'm2');
        const completedGoal = employeeGoalsEngine.toggleMilestone(goal.id, 'm3');
        assert.equal(completedGoal.progress, 100);
        assert.equal(completedGoal.status, 'completed');
    });

    await t.test('1.1.3 Schedule: Start date and target completion date are recorded', () => {
        const goal = employeeGoalsEngine.createGoal({
            title: 'Schedule Verification Goal',
            description: 'Validating start and target completion dates',
            schedule: {
                startDate: '2026-11-01',
                targetCompletionDate: '2026-12-15'
            }
        });

        assert.equal(goal.schedule.startDate, '2026-11-01');
        assert.equal(goal.schedule.targetCompletionDate, '2026-12-15');
    });

    await t.test('1.1.4 Track: Employees can update progress, current metric value, and status', () => {
        const goal = employeeGoalsEngine.createGoal({
            title: 'Memory Optimization & Leak Detection',
            measurement: { method: 'quantitative', target: 100, unit: '%' }
        });

        const actor = { name: 'Marry Doe', role: 'Senior Software Engineer' };
        const updated = employeeGoalsEngine.updateProgress(goal.id, 70, 'Heap profiling completed; resolved memory leak', actor, 70);

        assert.equal(updated.progress, 70);
        assert.equal(updated.measurement.current, 70);

        // Check history entry
        const latestHistory = updated.history[updated.history.length - 1];
        assert.equal(latestHistory.action, 'progress_updated');
        assert.equal(latestHistory.notes, 'Heap profiling completed; resolved memory leak');
        assert.equal(latestHistory.previousState.progress, 0);
        assert.equal(latestHistory.newState.progress, 70);
    });

    await t.test('1.1.5 Manage: Goals can be edited, paused, resumed, completed, or archived', () => {
        const actor = { name: 'Marry Doe', role: 'Senior Software Engineer' };
        const goal = employeeGoalsEngine.createGoal({
            title: 'Lifecycle Management Goal',
            description: 'Testing edit, pause, resume, complete, archive'
        }, actor);

        // Edit
        const edited = employeeGoalsEngine.updateGoal(goal.id, {
            title: 'Lifecycle Management Goal (Revised)',
            category: 'Innovation'
        }, actor);
        assert.equal(edited.title, 'Lifecycle Management Goal (Revised)');
        assert.equal(edited.category, 'Innovation');

        // Pause
        const paused = employeeGoalsEngine.pauseGoal(goal.id, 'Awaiting API credentials from vendor', actor);
        assert.equal(paused.status, 'paused');

        // Resume
        const resumed = employeeGoalsEngine.resumeGoal(goal.id, actor);
        assert.equal(resumed.status, 'active');

        // Complete
        const completed = employeeGoalsEngine.completeGoal(goal.id, 'Delivered ahead of schedule', actor);
        assert.equal(completed.status, 'completed');
        assert.equal(completed.progress, 100);

        // Archive
        const archived = employeeGoalsEngine.archiveGoal(goal.id, actor);
        assert.equal(archived.status, 'archived');
    });

    await t.test('1.1.6 History: The system records creation and all subsequent changes in chronological audit trail', () => {
        const actor = { name: 'Marry Doe', role: 'Senior Software Engineer' };
        const goal = employeeGoalsEngine.createGoal({
            title: 'Audit Trail Verification Goal',
            description: 'Validating history array integrity'
        }, actor);

        employeeGoalsEngine.updateGoal(goal.id, { description: 'Updated technical scope' }, actor);
        employeeGoalsEngine.updateProgress(goal.id, 50, 'Midpoint milestone achieved', actor);
        employeeGoalsEngine.pauseGoal(goal.id, 'Paused for sprint planning', actor);
        employeeGoalsEngine.resumeGoal(goal.id, actor);

        const history = employeeGoalsEngine.getGoalHistory(goal.id);
        assert.ok(history.length >= 5, `Expected at least 5 history items, got ${history.length}`);
        
        // Assert chronological descending order (newest first)
        for (let i = 0; i < history.length - 1; i++) {
            assert.ok(new Date(history[i].timestamp) >= new Date(history[i + 1].timestamp), 'History must be sorted in descending chronological order');
        }

        const actions = history.map(h => h.action);
        assert.ok(actions.includes('created'), 'History must include creation');
        assert.ok(actions.includes('edited'), 'History must include editing');
        assert.ok(actions.includes('progress_updated'), 'History must include progress updates');
        assert.ok(actions.includes('paused'), 'History must include pause');
        assert.ok(actions.includes('status_changed'), 'History must include resume/status change');
    });

    await t.test('1.1.7 KPI Statistics: Calculates summary counts and average progress', () => {
        const stats = employeeGoalsEngine.getGoalStatistics();
        assert.ok(typeof stats.total === 'number');
        assert.ok(typeof stats.active === 'number');
        assert.ok(typeof stats.paused === 'number');
        assert.ok(typeof stats.completed === 'number');
        assert.ok(typeof stats.avgProgress === 'number');
        assert.ok(stats.avgProgress >= 0 && stats.avgProgress <= 100);
    });
});
