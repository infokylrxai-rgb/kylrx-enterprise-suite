const crypto = require('crypto');
const logger = require('../utils/logger');

/**
 * Employee Goals Engine (Kylrx Enterprise Suite)
 * 
 * Requirement 1.1 Employee Goal Management:
 * Employees can create and manage their own goals.
 * Each goal describes an outcome, owner, measurement method and expected completion date.
 * - Create: Title, description, outcome, category, owner
 * - Measure: Target, unit, milestone checklist, completion criteria
 * - Schedule: Start date, target completion date, days remaining
 * - Track: Progress %, current value, status, check-in notes
 * - Manage: Edit, pause, resume, complete, archive
 * - History: Full immutable audit trail recording creation and subsequent changes
 */

class EmployeeGoalsEngine {
    constructor() {
        this.goals = new Map();
        this.initializeDefaultGoals();
    }

    /**
     * Generate unique ID
     */
    generateId() {
        return `EMP-GOAL-${Date.now()}-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;
    }

    /**
     * Pre-seed default employee goals for realistic out-of-the-box demonstration
     */
    initializeDefaultGoals() {
        const defaultGoals = [
            {
                id: 'EMP-GOAL-001',
                title: 'High-Throughput API Gateway Optimization',
                description: 'Refactor REST and GraphQL middleware routes, integrate Redis multi-tier caching, and cut response times for client endpoints.',
                outcome: 'Cut p99 API response latency below 80ms across all authenticated customer workflows.',
                category: 'Technical Excellence',
                owner: {
                    id: 'EMP-MARRY-DOE',
                    name: 'Marry Doe',
                    role: 'Senior Software Engineer',
                    email: 'marry.doe@kylrx.com',
                    department: 'Engineering',
                    departmentCode: 'UNIT-ENG-101'
                },
                measurement: {
                    method: 'unit',
                    target: 80,
                    current: 72,
                    unit: 'ms (p99 latency)',
                    completionCriteria: 'Stress-test load harness maintains sub-80ms p99 latency under 2,000 sustained requests per second.',
                    milestones: [
                        { id: 'm1', title: 'Profile endpoint execution bottlenecks and database queries', targetDate: '2026-10-15', completed: true, completedAt: '2026-10-14T10:00:00.000Z' },
                        { id: 'm2', title: 'Implement Redis distributed session caching layer', targetDate: '2026-11-01', completed: true, completedAt: '2026-10-18T14:30:00.000Z' },
                        { id: 'm3', title: 'Optimize PostgreSQL execution plans and composite indices', targetDate: '2026-11-15', completed: false, completedAt: null },
                        { id: 'm4', title: 'Execute automated k6 load testing suite in staging', targetDate: '2026-12-05', completed: false, completedAt: null }
                    ]
                },
                schedule: {
                    startDate: '2026-10-01',
                    targetCompletionDate: '2026-12-15',
                    actualCompletionDate: null
                },
                progress: 65,
                status: 'active',
                templateId: 'tpl_goal_latency_opt',
                createdAt: '2026-10-01T08:00:00.000Z',
                updatedAt: '2026-10-18T14:30:00.000Z',
                history: [
                    {
                        id: 'hist-emp-001',
                        timestamp: '2026-10-01T08:00:00.000Z',
                        actor: { id: 'EMP-MARRY-DOE', name: 'Marry Doe', role: 'Senior Software Engineer' },
                        action: 'created',
                        summary: 'Goal created: High-Throughput API Gateway Optimization with target sub-80ms latency.',
                        notes: 'Personal technical excellence OKR for Q4.'
                    },
                    {
                        id: 'hist-emp-002',
                        timestamp: '2026-10-14T10:00:00.000Z',
                        actor: { id: 'EMP-MARRY-DOE', name: 'Marry Doe', role: 'Senior Software Engineer' },
                        action: 'milestone_toggled',
                        summary: 'Milestone "Profile endpoint execution bottlenecks and database queries" marked as completed.',
                        notes: 'Profiling traces identified slow ORM hydration.'
                    },
                    {
                        id: 'hist-emp-003',
                        timestamp: '2026-10-18T14:30:00.000Z',
                        actor: { id: 'EMP-MARRY-DOE', name: 'Marry Doe', role: 'Senior Software Engineer' },
                        action: 'progress_updated',
                        summary: 'Progress updated from 35% to 65% after Redis cache rollout.',
                        previousState: { progress: 35 },
                        newState: { progress: 65 },
                        notes: 'Initial cache hit ratio reached 94%.'
                    }
                ]
            },
            {
                id: 'EMP-GOAL-002',
                title: 'Automated E2E Test Coverage Expansion',
                description: 'Write comprehensive integration and Playwright test suites covering payroll disbursement, appraisal forms, and onboarding flows.',
                outcome: 'Reach and sustain >90% end-to-end automated regression coverage across critical enterprise modules.',
                category: 'Quality & Reliability',
                owner: {
                    id: 'EMP-MARRY-DOE',
                    name: 'Marry Doe',
                    role: 'Senior Software Engineer',
                    email: 'marry.doe@kylrx.com',
                    department: 'Engineering',
                    departmentCode: 'UNIT-ENG-101'
                },
                measurement: {
                    method: 'quantitative',
                    target: 90,
                    current: 78,
                    unit: '% Test Coverage',
                    completionCriteria: 'CI pipeline enforces 90% branch and line coverage before PR merges are unlocked.',
                    milestones: [
                        { id: 'm1', title: 'Set up Playwright test runner and headless Chromium grid', targetDate: '2026-09-20', completed: true, completedAt: '2026-09-18T11:00:00.000Z' },
                        { id: 'm2', title: 'Build automated regression tests for Payroll calculations', targetDate: '2026-10-10', completed: true, completedAt: '2026-10-09T16:00:00.000Z' },
                        { id: 'm3', title: 'Add PMS self-appraisal workflow journey tests', targetDate: '2026-11-01', completed: false, completedAt: null },
                        { id: 'm4', title: 'Integrate code coverage reports into GitHub Actions CI', targetDate: '2026-11-20', completed: false, completedAt: null }
                    ]
                },
                schedule: {
                    startDate: '2026-09-01',
                    targetCompletionDate: '2026-11-25',
                    actualCompletionDate: null
                },
                progress: 55,
                status: 'active',
                templateId: 'tpl_goal_code_quality',
                createdAt: '2026-09-01T09:00:00.000Z',
                updatedAt: '2026-10-09T16:00:00.000Z',
                history: [
                    {
                        id: 'hist-emp-101',
                        timestamp: '2026-09-01T09:00:00.000Z',
                        actor: { id: 'EMP-MARRY-DOE', name: 'Marry Doe', role: 'Senior Software Engineer' },
                        action: 'created',
                        summary: 'Goal created: Automated E2E Test Coverage Expansion.'
                    },
                    {
                        id: 'hist-emp-102',
                        timestamp: '2026-10-09T16:00:00.000Z',
                        actor: { id: 'EMP-MARRY-DOE', name: 'Marry Doe', role: 'Senior Software Engineer' },
                        action: 'progress_updated',
                        summary: 'Progress updated from 25% to 55% after completing Payroll calculation test suite.',
                        previousState: { progress: 25 },
                        newState: { progress: 55 }
                    }
                ]
            },
            {
                id: 'EMP-GOAL-003',
                title: 'AWS Certified Solutions Architect Certification',
                description: 'Complete hands-on cloud architecture labs, pass all practice exam modules, and earn the official AWS Solutions Architect certification.',
                outcome: 'Certified AWS Solutions Architect transcript archived in HR credentials database.',
                category: 'Skill Acquisition & Certifications',
                owner: {
                    id: 'EMP-MARRY-DOE',
                    name: 'Marry Doe',
                    role: 'Senior Software Engineer',
                    email: 'marry.doe@kylrx.com',
                    department: 'Engineering',
                    departmentCode: 'UNIT-ENG-101'
                },
                measurement: {
                    method: 'milestone',
                    target: 4,
                    current: 2,
                    unit: 'Milestones',
                    completionCriteria: 'Official AWS certificate credential ID verified and validated.',
                    milestones: [
                        { id: 'm1', title: 'Complete Cloud Architecture video curriculum', targetDate: '2026-08-30', completed: true, completedAt: '2026-08-28T18:00:00.000Z' },
                        { id: 'm2', title: 'Pass 3 full-length practice exams with >85% score', targetDate: '2026-09-30', completed: true, completedAt: '2026-09-29T15:00:00.000Z' },
                        { id: 'm3', title: 'Complete hands-on serverless & VPC peering lab exercises', targetDate: '2026-10-31', completed: false, completedAt: null },
                        { id: 'm4', title: 'Sit and pass the official Pearson VUE proctored exam', targetDate: '2026-11-30', completed: false, completedAt: null }
                    ]
                },
                schedule: {
                    startDate: '2026-08-01',
                    targetCompletionDate: '2026-11-30',
                    actualCompletionDate: null
                },
                progress: 50,
                status: 'paused',
                templateId: 'tpl_goal_cloud_cert',
                createdAt: '2026-08-01T10:00:00.000Z',
                updatedAt: '2026-10-12T11:00:00.000Z',
                history: [
                    {
                        id: 'hist-emp-201',
                        timestamp: '2026-08-01T10:00:00.000Z',
                        actor: { id: 'EMP-MARRY-DOE', name: 'Marry Doe', role: 'Senior Software Engineer' },
                        action: 'created',
                        summary: 'Goal created: AWS Certified Solutions Architect Certification.'
                    },
                    {
                        id: 'hist-emp-202',
                        timestamp: '2026-10-12T11:00:00.000Z',
                        actor: { id: 'EMP-MARRY-DOE', name: 'Marry Doe', role: 'Senior Software Engineer' },
                        action: 'paused',
                        summary: 'Goal execution paused.',
                        notes: 'Temporarily prioritizing Q4 enterprise delivery sprint.'
                    }
                ]
            },
            {
                id: 'EMP-GOAL-004',
                title: 'Internal Developer Documentation & RFC Architecture',
                description: 'Write developer quickstart guides, architectural decision records (ADRs), and component library storybooks for seamless team onboarding.',
                outcome: 'Publish 8 comprehensive engineering runbooks and documentation guides.',
                category: 'Team & Culture',
                owner: {
                    id: 'EMP-MARRY-DOE',
                    name: 'Marry Doe',
                    role: 'Senior Software Engineer',
                    email: 'marry.doe@kylrx.com',
                    department: 'Engineering',
                    departmentCode: 'UNIT-ENG-101'
                },
                measurement: {
                    method: 'quantitative',
                    target: 8,
                    current: 8,
                    unit: 'Runbooks',
                    completionCriteria: 'All 8 runbooks peer-reviewed and published to Notion engineering wiki.',
                    milestones: [
                        { id: 'm1', title: 'Write local development Docker environment runbook', targetDate: '2026-07-15', completed: true, completedAt: '2026-07-14T09:00:00.000Z' },
                        { id: 'm2', title: 'Document microservices event-bus and queue contracts', targetDate: '2026-08-10', completed: true, completedAt: '2026-08-08T17:00:00.000Z' },
                        { id: 'm3', title: 'Publish troubleshooting runbook for live database alerts', targetDate: '2026-09-01', completed: true, completedAt: '2026-08-30T16:30:00.000Z' }
                    ]
                },
                schedule: {
                    startDate: '2026-07-01',
                    targetCompletionDate: '2026-09-15',
                    actualCompletionDate: '2026-09-10'
                },
                progress: 100,
                status: 'completed',
                templateId: 'tpl_goal_docs',
                createdAt: '2026-07-01T09:00:00.000Z',
                updatedAt: '2026-09-10T15:00:00.000Z',
                history: [
                    {
                        id: 'hist-emp-301',
                        timestamp: '2026-07-01T09:00:00.000Z',
                        actor: { id: 'EMP-MARRY-DOE', name: 'Marry Doe', role: 'Senior Software Engineer' },
                        action: 'created',
                        summary: 'Goal created: Internal Developer Documentation & RFC Architecture.'
                    },
                    {
                        id: 'hist-emp-302',
                        timestamp: '2026-09-10T15:00:00.000Z',
                        actor: { id: 'EMP-MARRY-DOE', name: 'Marry Doe', role: 'Senior Software Engineer' },
                        action: 'completed',
                        summary: 'Goal marked as completed (100% progress achieved).',
                        notes: 'All 8 guides published and approved.'
                    }
                ]
            }
        ];

        for (const g of defaultGoals) {
            this.goals.set(g.id, g);
        }
    }

    /**
     * Create a new employee goal
     */
    createGoal(goalData, actor = { name: 'Employee', role: 'Software Engineer' }) {
        if (!goalData.title || !goalData.title.trim()) {
            throw new Error('Goal title is required.');
        }

        const id = goalData.id || this.generateId();
        const now = new Date().toISOString();

        // Standardize milestones
        let milestones = [];
        if (Array.isArray(goalData.measurement?.milestones)) {
            milestones = goalData.measurement.milestones.map((m, idx) => ({
                id: m.id || `m_${idx + 1}`,
                title: m.title || `Milestone ${idx + 1}`,
                targetDate: m.targetDate || goalData.schedule?.targetCompletionDate || null,
                completed: !!m.completed,
                completedAt: m.completed ? (m.completedAt || now) : null
            }));
        }

        const newGoal = {
            id,
            title: goalData.title.trim(),
            description: (goalData.description || '').trim(),
            outcome: (goalData.outcome || goalData.description || '').trim(),
            category: goalData.category || 'Technical Excellence',
            owner: {
                id: actor.id || goalData.owner?.id || 'EMP-MARRY-DOE',
                name: actor.name || goalData.owner?.name || 'Marry Doe',
                role: actor.role || goalData.owner?.role || 'Software Engineer',
                email: actor.email || goalData.owner?.email || 'employee@kylrx.com',
                department: goalData.owner?.department || 'Engineering',
                departmentCode: goalData.owner?.departmentCode || 'UNIT-ENG-101'
            },
            measurement: {
                method: goalData.measurement?.method || 'quantitative', // 'quantitative' | 'milestone' | 'criteria' | 'unit'
                target: goalData.measurement?.target !== undefined ? goalData.measurement.target : 100,
                current: goalData.measurement?.current !== undefined ? goalData.measurement.current : 0,
                unit: goalData.measurement?.unit || '%',
                completionCriteria: goalData.measurement?.completionCriteria || 'Deliver outcome according to specifications.',
                milestones
            },
            schedule: {
                startDate: goalData.schedule?.startDate || now.split('T')[0],
                targetCompletionDate: goalData.schedule?.targetCompletionDate || '',
                actualCompletionDate: null
            },
            progress: Number(goalData.progress) || 0,
            status: goalData.status || 'active', // 'active' | 'in_progress' | 'paused' | 'completed' | 'archived' | 'draft'
            templateId: goalData.templateId || null,
            createdAt: now,
            updatedAt: now,
            history: []
        };

        // Record initial immutable history entry
        newGoal.history.push({
            id: `hist-${Date.now()}-init`,
            timestamp: now,
            actor: { id: actor.id || 'emp', name: actor.name, role: actor.role },
            action: 'created',
            summary: `Goal "${newGoal.title}" created. Target: ${newGoal.measurement.target} ${newGoal.measurement.unit}.`,
            notes: goalData.initialNotes || 'Goal initialized.'
        });

        this.goals.set(id, newGoal);
        logger.info(`[EmployeeGoalsEngine] Created goal ${id}: "${newGoal.title}" by ${actor.name}`);
        return newGoal;
    }

    /**
     * Retrieve single goal by ID
     */
    getGoal(id) {
        const goal = this.goals.get(id);
        if (!goal) {
            throw new Error(`Goal with ID "${id}" not found.`);
        }
        return goal;
    }

    /**
     * List all goals with optional filters
     */
    listGoals({ ownerId, status, category, search } = {}) {
        let results = Array.from(this.goals.values());

        if (ownerId) {
            results = results.filter(g => g.owner?.id === ownerId || g.owner?.email === ownerId || g.owner?.name === ownerId);
        }

        if (status && status !== 'all') {
            results = results.filter(g => g.status === status);
        }

        if (category && category !== 'all') {
            results = results.filter(g => g.category.toLowerCase() === category.toLowerCase());
        }

        if (search) {
            const q = search.toLowerCase();
            results = results.filter(g => 
                g.title.toLowerCase().includes(q) || 
                g.description.toLowerCase().includes(q) || 
                g.outcome.toLowerCase().includes(q)
            );
        }

        // Sort descending by updatedAt
        return results.sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));
    }

    /**
     * Update general goal fields (Manage: Edit)
     */
    updateGoal(id, updates, actor = { name: 'Employee', role: 'Software Engineer' }) {
        const goal = this.getGoal(id);
        const previousState = {
            title: goal.title,
            description: goal.description,
            outcome: goal.outcome,
            target: goal.measurement.target,
            targetCompletionDate: goal.schedule.targetCompletionDate,
            category: goal.category
        };

        if (updates.title) goal.title = updates.title.trim();
        if (updates.description !== undefined) goal.description = updates.description.trim();
        if (updates.outcome !== undefined) goal.outcome = updates.outcome.trim();
        if (updates.category) goal.category = updates.category;

        if (updates.measurement) {
            goal.measurement = {
                ...goal.measurement,
                ...updates.measurement
            };
        }

        if (updates.schedule) {
            goal.schedule = {
                ...goal.schedule,
                ...updates.schedule
            };
        }

        if (updates.progress !== undefined) {
            goal.progress = Math.min(100, Math.max(0, Number(updates.progress)));
        }

        if (updates.status) {
            goal.status = updates.status;
        }

        const now = new Date().toISOString();
        goal.updatedAt = now;

        goal.history.push({
            id: `hist-${Date.now()}-edit`,
            timestamp: now,
            actor: { id: actor.id || 'emp', name: actor.name, role: actor.role },
            action: 'edited',
            summary: `Goal configuration updated by ${actor.name}.`,
            previousState,
            newState: {
                title: goal.title,
                target: goal.measurement.target,
                targetCompletionDate: goal.schedule.targetCompletionDate
            },
            notes: updates.changeNotes || 'Goal details revised.'
        });

        this.goals.set(id, goal);
        logger.info(`[EmployeeGoalsEngine] Updated goal ${id} by ${actor.name}`);
        return goal;
    }

    /**
     * Track: Update progress % and notes
     */
    updateProgress(id, progress, note = '', actor = { name: 'Employee', role: 'Software Engineer' }, currentValue = null) {
        const goal = this.getGoal(id);
        const prevProg = goal.progress;
        const newProg = Math.min(100, Math.max(0, Number(progress)));
        
        goal.progress = newProg;
        if (currentValue !== null && currentValue !== undefined) {
            goal.measurement.current = currentValue;
        }

        // Auto-complete if 100% and currently active
        let autoCompleted = false;
        if (newProg === 100 && (goal.status === 'active' || goal.status === 'in_progress')) {
            goal.status = 'completed';
            goal.schedule.actualCompletionDate = new Date().toISOString().split('T')[0];
            autoCompleted = true;
        }

        const now = new Date().toISOString();
        goal.updatedAt = now;

        goal.history.push({
            id: `hist-${Date.now()}-prog`,
            timestamp: now,
            actor: { id: actor.id || 'emp', name: actor.name, role: actor.role },
            action: 'progress_updated',
            summary: `Progress changed from ${prevProg}% to ${newProg}%${autoCompleted ? ' (Marked as Completed)' : ''}.`,
            previousState: { progress: prevProg },
            newState: { progress: newProg, status: goal.status },
            notes: note || 'Progress check-in logged.'
        });

        this.goals.set(id, goal);
        logger.info(`[EmployeeGoalsEngine] Goal ${id} progress updated to ${newProg}%`);
        return goal;
    }

    /**
     * Manage: Update status (active, in_progress, paused, completed, archived)
     */
    updateStatus(id, newStatus, reason = '', actor = { name: 'Employee', role: 'Software Engineer' }) {
        const validStatuses = ['active', 'in_progress', 'paused', 'completed', 'archived', 'draft'];
        if (!validStatuses.includes(newStatus)) {
            throw new Error(`Invalid status "${newStatus}". Must be one of: ${validStatuses.join(', ')}`);
        }

        const goal = this.getGoal(id);
        const prevStatus = goal.status;
        if (prevStatus === newStatus) return goal;

        goal.status = newStatus;
        const now = new Date().toISOString();
        goal.updatedAt = now;

        if (newStatus === 'completed') {
            goal.progress = 100;
            goal.schedule.actualCompletionDate = now.split('T')[0];
        }

        goal.history.push({
            id: `hist-${Date.now()}-status`,
            timestamp: now,
            actor: { id: actor.id || 'emp', name: actor.name, role: actor.role },
            action: newStatus === 'paused' ? 'paused' : (newStatus === 'completed' ? 'completed' : (newStatus === 'archived' ? 'archived' : 'status_changed')),
            summary: `Status updated from "${prevStatus}" to "${newStatus}".`,
            previousState: { status: prevStatus },
            newState: { status: newStatus },
            notes: reason || `Status transitioned to ${newStatus}.`
        });

        this.goals.set(id, goal);
        logger.info(`[EmployeeGoalsEngine] Goal ${id} status changed from ${prevStatus} to ${newStatus}`);
        return goal;
    }

    /**
     * Pause a goal
     */
    pauseGoal(id, reason = '', actor) {
        return this.updateStatus(id, 'paused', reason || 'Goal execution paused by employee.', actor);
    }

    /**
     * Resume a paused goal
     */
    resumeGoal(id, actor) {
        return this.updateStatus(id, 'active', 'Goal resumed to active progress.', actor);
    }

    /**
     * Complete a goal
     */
    completeGoal(id, notes = '', actor) {
        return this.updateStatus(id, 'completed', notes || 'Goal marked as successfully completed.', actor);
    }

    /**
     * Archive a goal
     */
    archiveGoal(id, actor) {
        return this.updateStatus(id, 'archived', 'Goal archived.', actor);
    }

    /**
     * Measure: Toggle a milestone
     */
    toggleMilestone(id, milestoneId, actor = { name: 'Employee', role: 'Software Engineer' }) {
        const goal = this.getGoal(id);
        const milestone = goal.measurement.milestones?.find(m => m.id === milestoneId);
        if (!milestone) {
            throw new Error(`Milestone "${milestoneId}" not found in goal "${id}".`);
        }

        milestone.completed = !milestone.completed;
        const now = new Date().toISOString();
        milestone.completedAt = milestone.completed ? now : null;
        goal.updatedAt = now;

        // Auto recalculate progress if measurement method is milestone-based
        if (goal.measurement.method === 'milestone' && goal.measurement.milestones.length > 0) {
            const completedCount = goal.measurement.milestones.filter(m => m.completed).length;
            const total = goal.measurement.milestones.length;
            goal.measurement.current = completedCount;
            goal.progress = Math.round((completedCount / total) * 100);
            if (completedCount === total) {
                goal.status = 'completed';
                goal.schedule.actualCompletionDate = now.split('T')[0];
            }
        }

        goal.history.push({
            id: `hist-${Date.now()}-milestone`,
            timestamp: now,
            actor: { id: actor.id || 'emp', name: actor.name, role: actor.role },
            action: 'milestone_toggled',
            summary: `Milestone "${milestone.title}" marked as ${milestone.completed ? 'Completed' : 'Pending'}.`,
            newState: { milestoneId, completed: milestone.completed, progress: goal.progress }
        });

        this.goals.set(id, goal);
        return goal;
    }

    /**
     * Add a direct note / check-in to goal history
     */
    addCheckInNote(id, note, actor = { name: 'Employee', role: 'Software Engineer' }) {
        const goal = this.getGoal(id);
        const now = new Date().toISOString();
        goal.updatedAt = now;

        const entry = {
            id: `hist-${Date.now()}-note`,
            timestamp: now,
            actor: { id: actor.id || 'emp', name: actor.name, role: actor.role },
            action: 'note_added',
            summary: `Check-in note added by ${actor.name}.`,
            notes: note
        };

        goal.history.push(entry);
        this.goals.set(id, goal);
        return entry;
    }

    /**
     * History: Get goal immutable audit history
     */
    getGoalHistory(id) {
        const goal = this.getGoal(id);
        return [...goal.history].sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
    }

    /**
     * Compute employee goal KPI summary statistics
     */
    getGoalStatistics(ownerId = null) {
        const allGoals = this.listGoals(ownerId ? { ownerId } : {});
        const total = allGoals.length;
        const active = allGoals.filter(g => g.status === 'active' || g.status === 'in_progress').length;
        const paused = allGoals.filter(g => g.status === 'paused').length;
        const completed = allGoals.filter(g => g.status === 'completed').length;
        const archived = allGoals.filter(g => g.status === 'archived').length;
        const avgProgress = total > 0 ? Math.round(allGoals.reduce((acc, g) => acc + (g.progress || 0), 0) / total) : 0;

        return {
            total,
            active,
            paused,
            completed,
            archived,
            avgProgress
        };
    }
}

const employeeGoalsEngine = new EmployeeGoalsEngine();
module.exports = employeeGoalsEngine;
