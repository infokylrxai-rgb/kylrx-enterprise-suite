const crypto = require('crypto');
const logger = require('../utils/logger');

/**
 * Manager Goals Engine (Kylrx Enterprise Suite)
 * 
 * Requirement 1.1 Manager Goal Management:
 * Managers should be able to create and manage their own goals.
 * Each goal describes an outcome, owner, measurement method and expected completion date.
 * - Create: Title, description, outcome, category
 * - Measure: Target, unit, milestone checklist, completion criteria
 * - Schedule: Start date, target completion date, days remaining
 * - Track: Progress %, current value, status, check-in notes
 * - Manage: Edit, pause, resume, complete, archive
 * - History: Full immutable audit trail recording creation and subsequent changes
 */

class ManagerGoalsEngine {
    constructor() {
        this.goals = new Map();
        this.initializeDefaultGoals();
    }

    /**
     * Generate unique ID
     */
    generateId() {
        return `MGR-GOAL-${Date.now()}-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;
    }

    /**
     * Pre-seed default manager goals for realistic out-of-the-box demonstration
     */
    initializeDefaultGoals() {
        const defaultGoals = [
            {
                id: 'MGR-GOAL-CYB-001',
                title: 'Zero-Trust Architecture & Threat Hardening',
                description: 'Implement end-to-end identity verification, multi-factor gateway enforcement, and automated endpoint telemetry across all department nodes.',
                outcome: 'Achieve zero security breaches and reach 99.99% compliant network infrastructure across all enterprise endpoints.',
                category: 'Cybersecurity & Compliance',
                owner: {
                    id: 'MGR-JOHN-DOE',
                    name: 'John Doe',
                    role: 'Cybersecurity Manager',
                    email: 'john.doe@kylrx.com',
                    department: 'Cybersecurity',
                    departmentCode: 'UNIT-CYB-802'
                },
                measurement: {
                    method: 'quantitative',
                    target: 99.9,
                    current: 85,
                    unit: '% Compliance',
                    completionCriteria: 'All 802 regional nodes pass automated vulnerability scanners and have mTLS authentication active.',
                    milestones: [
                        { id: 'm1', title: 'Complete IAM zero-trust policy matrix', targetDate: '2026-10-15', completed: true, completedAt: '2026-10-14T10:00:00.000Z' },
                        { id: 'm2', title: 'Deploy mTLS certificate rotations to microservices', targetDate: '2026-11-01', completed: true, completedAt: '2026-10-18T09:30:00.000Z' },
                        { id: 'm3', title: 'Enforce MFA on internal admin jump hosts', targetDate: '2026-11-15', completed: false, completedAt: null },
                        { id: 'm4', title: 'Conduct external penetration audit and remediation', targetDate: '2026-12-05', completed: false, completedAt: null }
                    ]
                },
                schedule: {
                    startDate: '2026-10-01',
                    targetCompletionDate: '2026-12-15',
                    actualCompletionDate: null
                },
                progress: 75,
                status: 'active',
                templateId: 'tpl_goal_zerotrust',
                createdAt: '2026-10-01T08:00:00.000Z',
                updatedAt: '2026-10-18T10:00:00.000Z',
                history: [
                    {
                        id: 'hist-001',
                        timestamp: '2026-10-01T08:00:00.000Z',
                        actor: { id: 'MGR-JOHN-DOE', name: 'John Doe', role: 'Cybersecurity Manager' },
                        action: 'created',
                        summary: 'Goal created from Zero-Trust Security Template with target of 99.9% Compliance.',
                        notes: 'Initial strategic goal configuration for Q4.'
                    },
                    {
                        id: 'hist-002',
                        timestamp: '2026-10-14T10:00:00.000Z',
                        actor: { id: 'MGR-JOHN-DOE', name: 'John Doe', role: 'Cybersecurity Manager' },
                        action: 'milestone_toggled',
                        summary: 'Milestone "Complete IAM zero-trust policy matrix" marked as completed.',
                        notes: 'Policy matrix approved by CISO.'
                    },
                    {
                        id: 'hist-003',
                        timestamp: '2026-10-18T09:30:00.000Z',
                        actor: { id: 'MGR-JOHN-DOE', name: 'John Doe', role: 'Cybersecurity Manager' },
                        action: 'progress_updated',
                        summary: 'Progress updated from 50% to 75% after mTLS deployment.',
                        previousState: { progress: 50 },
                        newState: { progress: 75 },
                        notes: 'Phase 2 rotation validated successfully.'
                    }
                ]
            },
            {
                id: 'MGR-GOAL-CYB-002',
                title: 'SOC2 Type II Audit Readiness & Evidence Collection',
                description: 'Aggregate access logs, cryptographic audit logs, and employee security training verification into centralized audit binders.',
                outcome: 'Flawless SOC2 Type II certification report with zero non-conformity findings.',
                category: 'Cybersecurity & Compliance',
                owner: {
                    id: 'MGR-JOHN-DOE',
                    name: 'John Doe',
                    role: 'Cybersecurity Manager',
                    email: 'john.doe@kylrx.com',
                    department: 'Cybersecurity',
                    departmentCode: 'UNIT-CYB-802'
                },
                measurement: {
                    method: 'milestone',
                    target: 4,
                    current: 3,
                    unit: 'Milestones',
                    completionCriteria: 'Auditor signs off on all 4 trust service principles: Security, Availability, Processing Integrity, Confidentiality.',
                    milestones: [
                        { id: 'm1', title: 'Automated continuous evidence collectors enabled', targetDate: '2026-09-20', completed: true, completedAt: '2026-09-18T14:20:00.000Z' },
                        { id: 'm2', title: '100% staff completion of annual security training', targetDate: '2026-10-05', completed: true, completedAt: '2026-10-04T16:00:00.000Z' },
                        { id: 'm3', title: 'Dry-run audit review with internal compliance counsel', targetDate: '2026-10-15', completed: true, completedAt: '2026-10-15T11:00:00.000Z' },
                        { id: 'm4', title: 'Final auditor sign-off and SOC2 Type II report issuance', targetDate: '2026-11-20', completed: false, completedAt: null }
                    ]
                },
                schedule: {
                    startDate: '2026-09-01',
                    targetCompletionDate: '2026-11-20',
                    actualCompletionDate: null
                },
                progress: 75,
                status: 'active',
                templateId: 'tpl_goal_okr_delivery',
                createdAt: '2026-09-01T09:00:00.000Z',
                updatedAt: '2026-10-15T11:00:00.000Z',
                history: [
                    {
                        id: 'hist-101',
                        timestamp: '2026-09-01T09:00:00.000Z',
                        actor: { id: 'MGR-JOHN-DOE', name: 'John Doe', role: 'Cybersecurity Manager' },
                        action: 'created',
                        summary: 'Goal created: SOC2 Type II Audit Readiness & Evidence Collection.'
                    },
                    {
                        id: 'hist-102',
                        timestamp: '2026-10-15T11:00:00.000Z',
                        actor: { id: 'MGR-JOHN-DOE', name: 'John Doe', role: 'Cybersecurity Manager' },
                        action: 'milestone_toggled',
                        summary: 'Completed milestone: Dry-run audit review with internal compliance counsel.',
                        newState: { progress: 75 }
                    }
                ]
            },
            {
                id: 'MGR-GOAL-CYB-003',
                title: 'Incident Response MTTR Reduction Under 15 Minutes',
                description: 'Refactor triage runbooks and integrate automated Slack/PagerDuty escalation bots to cut mean time to resolution.',
                outcome: 'Average MTTR dropped to less than 15 minutes for critical P1/P2 cybersecurity anomalies.',
                category: 'Operational Excellence',
                owner: {
                    id: 'MGR-JOHN-DOE',
                    name: 'John Doe',
                    role: 'Cybersecurity Manager',
                    email: 'john.doe@kylrx.com',
                    department: 'Cybersecurity',
                    departmentCode: 'UNIT-CYB-802'
                },
                measurement: {
                    method: 'unit',
                    target: 15,
                    current: 22,
                    unit: 'Minutes MTTR',
                    completionCriteria: 'P1 incident simulation yields resolution under 15 minutes consistently across 3 consecutive drills.',
                    milestones: [
                        { id: 'm1', title: 'Deploy AI-based anomaly detector integration', targetDate: '2026-09-15', completed: true, completedAt: '2026-09-14T12:00:00.000Z' },
                        { id: 'm2', title: 'Automated remediation scripts for DDOS & brute-force', targetDate: '2026-10-25', completed: false, completedAt: null },
                        { id: 'm3', title: 'Conduct unannounced Red Team tabletop drill', targetDate: '2026-11-10', completed: false, completedAt: null }
                    ]
                },
                schedule: {
                    startDate: '2026-09-01',
                    targetCompletionDate: '2026-11-15',
                    actualCompletionDate: null
                },
                progress: 40,
                status: 'paused',
                templateId: 'tpl_goal_incident_sla',
                createdAt: '2026-09-01T10:00:00.000Z',
                updatedAt: '2026-10-16T15:00:00.000Z',
                history: [
                    {
                        id: 'hist-201',
                        timestamp: '2026-09-01T10:00:00.000Z',
                        actor: { id: 'MGR-JOHN-DOE', name: 'John Doe', role: 'Cybersecurity Manager' },
                        action: 'created',
                        summary: 'Goal created: Incident Response MTTR Reduction.'
                    },
                    {
                        id: 'hist-202',
                        timestamp: '2026-10-16T15:00:00.000Z',
                        actor: { id: 'MGR-JOHN-DOE', name: 'John Doe', role: 'Cybersecurity Manager' },
                        action: 'paused',
                        summary: 'Goal paused temporarily.',
                        notes: 'Awaiting vendor telemetry ingestion API upgrade in mid-November.'
                    }
                ]
            },
            {
                id: 'MGR-GOAL-CYB-004',
                title: 'Team Security Upskilling & CISSP Certifications',
                description: 'Organize training modules and voucher sponsorships for department engineers to achieve enterprise security certifications.',
                outcome: '5 security team leads certified with CISSP / CISM credentials.',
                category: 'Team Development',
                owner: {
                    id: 'MGR-JOHN-DOE',
                    name: 'John Doe',
                    role: 'Cybersecurity Manager',
                    email: 'john.doe@kylrx.com',
                    department: 'Cybersecurity',
                    departmentCode: 'UNIT-CYB-802'
                },
                measurement: {
                    method: 'quantitative',
                    target: 5,
                    current: 5,
                    unit: 'Certifications',
                    completionCriteria: 'Official certificate transcripts received and archived in HR employee profiles.',
                    milestones: [
                        { id: 'm1', title: 'Procure certification exam vouchers', targetDate: '2026-07-15', completed: true, completedAt: '2026-07-14T09:00:00.000Z' },
                        { id: 'm2', title: 'Complete 8-week bootcamp study groups', targetDate: '2026-08-30', completed: true, completedAt: '2026-08-28T18:00:00.000Z' },
                        { id: 'm3', title: 'All 5 candidates pass official exam', targetDate: '2026-09-30', completed: true, completedAt: '2026-09-29T17:30:00.000Z' }
                    ]
                },
                schedule: {
                    startDate: '2026-07-01',
                    targetCompletionDate: '2026-09-30',
                    actualCompletionDate: '2026-09-29'
                },
                progress: 100,
                status: 'completed',
                templateId: 'tpl_goal_team_upskill',
                createdAt: '2026-07-01T09:00:00.000Z',
                updatedAt: '2026-09-29T17:30:00.000Z',
                history: [
                    {
                        id: 'hist-301',
                        timestamp: '2026-07-01T09:00:00.000Z',
                        actor: { id: 'MGR-JOHN-DOE', name: 'John Doe', role: 'Cybersecurity Manager' },
                        action: 'created',
                        summary: 'Goal created: Team Security Upskilling & CISSP Certifications.'
                    },
                    {
                        id: 'hist-302',
                        timestamp: '2026-09-29T17:30:00.000Z',
                        actor: { id: 'MGR-JOHN-DOE', name: 'John Doe', role: 'Cybersecurity Manager' },
                        action: 'completed',
                        summary: 'Goal completed successfully (100% achieved).',
                        notes: 'All 5 engineers passed on first attempt!'
                    }
                ]
            }
        ];

        for (const g of defaultGoals) {
            this.goals.set(g.id, g);
        }
    }

    /**
     * Create a new manager goal
     */
    createGoal(goalData, actor = { name: 'Manager', role: 'Department Manager' }) {
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

        // PRD 1.3: Verify template status and capture frozen version snapshot
        let templateVersion = goalData.templateVersion || null;
        let templateSnapshot = goalData.templateSnapshot || null;

        if (goalData.templateId && !templateSnapshot) {
            try {
                const customTemplateEngine = require('./custom-template-engine');
                const tpl = customTemplateEngine.getTemplate(goalData.templateId);
                
                // PRD 1.3: Archived templates unavailable for new use
                if (tpl.status === 'archived') {
                    throw new Error(`Cannot create goal from template "${tpl.name}": Template is Archived and unavailable for new use.`);
                }
                
                // PRD 1.3: Draft templates not available for general use
                if (tpl.status === 'draft') {
                    const isPrivileged = actor.role === 'super_admin' || 
                                         actor.role === 'hr_admin' || 
                                         tpl.ownerId === actor.id || 
                                         tpl.ownerName === actor.name || 
                                         tpl.createdBy?.includes(actor.name);
                    if (!isPrivileged) {
                        throw new Error(`Cannot create goal from template "${tpl.name}": Template is in Draft status and not available for general use.`);
                    }
                }

                templateVersion = tpl.version;
                templateSnapshot = {
                    templateId: tpl.id,
                    templateKey: tpl.key,
                    templateName: tpl.name,
                    version: tpl.version,
                    scope: tpl.scope,
                    module: tpl.module,
                    structure: JSON.parse(JSON.stringify(tpl.structure || {})),
                    permittedFields: JSON.parse(JSON.stringify(tpl.permittedFields || [])),
                    lockedFields: [...(tpl.lockedFields || [])],
                    instructions: tpl.instructions
                };
            } catch (err) {
                if (err.message.includes('Archived') || err.message.includes('Draft')) throw err;
                // If template not found in map, proceed with provided values
            }
        }

        const newGoal = {
            id,
            title: goalData.title.trim(),
            description: (goalData.description || '').trim(),
            outcome: (goalData.outcome || goalData.description || '').trim(),
            category: goalData.category || 'Operational Excellence',
            owner: {
                id: actor.id || goalData.owner?.id || 'MGR-JOHN-DOE',
                name: actor.name || goalData.owner?.name || 'John Doe',
                role: actor.role || goalData.owner?.role || 'Department Manager',
                email: actor.email || goalData.owner?.email || 'manager@kylrx.com',
                department: goalData.owner?.department || 'Cybersecurity',
                departmentCode: goalData.owner?.departmentCode || 'UNIT-CYB-802'
            },
            measurement: {
                method: goalData.measurement?.method || 'quantitative', // 'quantitative' | 'milestone' | 'criteria' | 'unit'
                target: goalData.measurement?.target !== undefined ? goalData.measurement.target : 100,
                current: goalData.measurement?.current !== undefined ? goalData.measurement.current : 0,
                unit: goalData.measurement?.unit || '%',
                completionCriteria: goalData.measurement?.completionCriteria || 'Complete all deliverables on schedule.',
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
            templateVersion,
            templateSnapshot,
            createdAt: now,
            updatedAt: now,
            history: []
        };

        // Record initial history entry
        newGoal.history.push({
            id: `hist-${Date.now()}-init`,
            timestamp: now,
            actor: { id: actor.id || 'mgr', name: actor.name, role: actor.role },
            action: 'created',
            summary: `Goal "${newGoal.title}" created. Target: ${newGoal.measurement.target} ${newGoal.measurement.unit}.`,
            notes: goalData.initialNotes || 'Goal initialized.'
        });

        this.goals.set(id, newGoal);
        logger.info(`[ManagerGoalsEngine] Created goal ${id}: "${newGoal.title}" by ${actor.name}`);
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
            results = results.filter(g => g.owner?.id === ownerId || g.owner?.email === ownerId);
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
     * Update general goal fields
     */
    updateGoal(id, updates, actor = { name: 'Manager', role: 'Department Manager' }) {
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
            actor: { id: actor.id || 'mgr', name: actor.name, role: actor.role },
            action: 'edited',
            summary: `Goal configuration updated by ${actor.name}.`,
            previousState,
            newState: {
                title: goal.title,
                target: goal.measurement.target,
                targetCompletionDate: goal.schedule.targetCompletionDate
            },
            notes: updates.changeNotes || 'General details modified.'
        });

        this.goals.set(id, goal);
        logger.info(`[ManagerGoalsEngine] Updated goal ${id} by ${actor.name}`);
        return goal;
    }

    /**
     * Update progress and log history
     */
    updateProgress(id, progress, note = '', actor = { name: 'Manager', role: 'Department Manager' }, currentValue = null) {
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
            actor: { id: actor.id || 'mgr', name: actor.name, role: actor.role },
            action: 'progress_updated',
            summary: `Progress changed from ${prevProg}% to ${newProg}%${autoCompleted ? ' (Marked as Completed)' : ''}.`,
            previousState: { progress: prevProg },
            newState: { progress: newProg, status: goal.status },
            notes: note || 'Progress check-in recorded.'
        });

        this.goals.set(id, goal);
        logger.info(`[ManagerGoalsEngine] Goal ${id} progress updated to ${newProg}%`);
        return goal;
    }

    /**
     * Update status (active, paused, completed, archived)
     */
    updateStatus(id, newStatus, reason = '', actor = { name: 'Manager', role: 'Department Manager' }) {
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
            actor: { id: actor.id || 'mgr', name: actor.name, role: actor.role },
            action: newStatus === 'paused' ? 'paused' : (newStatus === 'completed' ? 'completed' : (newStatus === 'archived' ? 'archived' : 'status_changed')),
            summary: `Status updated from "${prevStatus}" to "${newStatus}".`,
            previousState: { status: prevStatus },
            newState: { status: newStatus },
            notes: reason || `Status transitioned to ${newStatus}.`
        });

        this.goals.set(id, goal);
        logger.info(`[ManagerGoalsEngine] Goal ${id} status changed from ${prevStatus} to ${newStatus}`);
        return goal;
    }

    /**
     * Pause a goal
     */
    pauseGoal(id, reason = '', actor) {
        return this.updateStatus(id, 'paused', reason || 'Goal execution paused by manager.', actor);
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
     * Toggle a milestone
     */
    toggleMilestone(id, milestoneId, actor = { name: 'Manager', role: 'Department Manager' }) {
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
            actor: { id: actor.id || 'mgr', name: actor.name, role: actor.role },
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
    addCheckInNote(id, note, actor = { name: 'Manager', role: 'Department Manager' }) {
        const goal = this.getGoal(id);
        const now = new Date().toISOString();
        goal.updatedAt = now;

        const entry = {
            id: `hist-${Date.now()}-note`,
            timestamp: now,
            actor: { id: actor.id || 'mgr', name: actor.name, role: actor.role },
            action: 'note_added',
            summary: `Manager check-in note added by ${actor.name}.`,
            notes: note
        };

        goal.history.push(entry);
        this.goals.set(id, goal);
        return entry;
    }

    /**
     * Get goal audit history
     */
    getGoalHistory(id) {
        const goal = this.getGoal(id);
        return [...goal.history].sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
    }

    /**
     * Compute manager goal KPI summary statistics
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

const managerGoalsEngine = new ManagerGoalsEngine();
module.exports = managerGoalsEngine;
