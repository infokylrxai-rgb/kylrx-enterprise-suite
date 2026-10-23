/**
 * employee-goals-controller.js
 * 
 * Interactive UI Controller for:
 * 1.1 Employee Goal Management
 * 
 * Implements:
 * - Goal creation, quantitative/milestone/unit/criteria measurement, scheduling
 * - Interactive progress tracking, status transitions (active, paused, completed, archived)
 * - Immutable chronological audit trail history viewer
 * - Template library browsing for employee goals
 * - Real-time milestone checkbox toggling with automatic progress recalculation
 * - Fully synchronized with REST API backend (/api/employee-goals) with graceful localStorage fallback
 */

(function () {
    // Intelligent API Base Resolution
    let API_BASE = '/api';
    if (typeof window !== 'undefined' && window.location) {
        if (window.API_BASE) {
            API_BASE = window.API_BASE.endsWith('/api') ? window.API_BASE : `${window.API_BASE}/api`;
        } else if (window.location.port && window.location.port !== '3000' && (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1')) {
            API_BASE = 'http://localhost:3000/api';
        } else {
            API_BASE = '/api';
        }
    }

    // Default Seed Goals for Employees conforming strictly to PRD 1.1 Goal Management
    const SEED_EMPLOYEE_GOALS = [
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
                department: 'Engineering'
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
                department: 'Engineering'
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
                department: 'Engineering'
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
                department: 'Engineering'
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

    // Standard Goal Templates for Employees
    const STANDARD_EMPLOYEE_TEMPLATES = [
        {
            id: 'tpl_goal_latency_opt',
            name: 'API Latency & Bottleneck Optimization',
            category: 'Technical Excellence',
            description: 'Structured framework for profiling database queries, microservices latency, and distributed caching.',
            outcome: 'Sub-100ms p95 API response latency verified under production traffic loads.',
            measurement: { method: 'unit', target: 80, unit: 'ms (p99 latency)', completionCriteria: 'Automated k6 load tests certify sub-80ms p99 response times.' },
            milestones: [
                { title: 'Profile endpoint execution bottlenecks and database queries' },
                { title: 'Implement Redis distributed session caching layer' },
                { title: 'Optimize PostgreSQL execution plans and composite indices' },
                { title: 'Execute automated k6 load testing suite in staging' }
            ]
        },
        {
            id: 'tpl_goal_code_quality',
            name: 'Automated E2E Test Coverage Expansion',
            category: 'Quality & Reliability',
            description: 'Best practice template for writing unit, integration, and Playwright end-to-end regression suites.',
            outcome: 'Achieve >90% automated branch and statement test coverage across assigned services.',
            measurement: { method: 'quantitative', target: 90, unit: '% Test Coverage', completionCriteria: 'CI pipeline blocks merge on <90% test coverage.' },
            milestones: [
                { title: 'Set up Playwright test runner and headless Chromium grid' },
                { title: 'Build automated regression tests for critical business logic' },
                { title: 'Integrate code coverage reports into GitHub Actions CI' }
            ]
        },
        {
            id: 'tpl_goal_cloud_cert',
            name: 'Cloud Architecture & Professional Certification',
            category: 'Skill Acquisition & Certifications',
            description: 'Individual learning and certification track for AWS, GCP, Azure, or Kubernetes certifications.',
            outcome: 'Pass official exam and verify certification credentials with HR profile.',
            measurement: { method: 'milestone', target: 4, unit: 'Milestones', completionCriteria: 'Verified digital certificate transcript published.' },
            milestones: [
                { title: 'Complete video curriculum and theory modules' },
                { title: 'Pass 3 full-length practice exams with >85% score' },
                { title: 'Complete hands-on cloud sandbox lab exercises' },
                { title: 'Sit and pass the official proctored certification exam' }
            ]
        },
        {
            id: 'tpl_goal_docs',
            name: 'Engineering Documentation & RFC Architecture',
            category: 'Team & Culture',
            description: 'Authoritative documentation sprint template for creating architectural runbooks, ADRs, and onboarding docs.',
            outcome: 'Publish internal RFCs and operational runbooks for dev teams.',
            measurement: { method: 'quantitative', target: 8, unit: 'Runbooks', completionCriteria: 'All runbooks peer-reviewed and merged.' },
            milestones: [
                { title: 'Draft and review Architecture Decision Records (ADRs)' },
                { title: 'Document service event contracts and schema payloads' },
                { title: 'Publish troubleshooting runbook and incident runbooks' }
            ]
        }
    ];

    function getLocalEmployeeGoals() {
        try {
            const raw = localStorage.getItem('kylrx_employee_goals');
            if (raw) return JSON.parse(raw);
        } catch (e) {
            console.warn('[EmployeeGoals] Could not read localStorage goals:', e);
        }
        saveLocalEmployeeGoals(SEED_EMPLOYEE_GOALS);
        return JSON.parse(JSON.stringify(SEED_EMPLOYEE_GOALS));
    }

    function saveLocalEmployeeGoals(goals) {
        try {
            localStorage.setItem('kylrx_employee_goals', JSON.stringify(goals));
        } catch (e) {
            console.warn('[EmployeeGoals] Could not save goals to localStorage:', e);
        }
    }

    // Controller State
    const state = {
        goals: [],
        filteredGoals: [],
        goalFilter: 'all',
        goalCategoryFilter: 'all',
        goalSearchQuery: '',
        currentGoalId: null,
        currentMilestones: [],
        actor: {
            id: 'EMP-MARRY-DOE',
            name: 'Marry Doe',
            role: 'Senior Software Engineer',
            email: 'marry.doe@kylrx.com',
            department: 'Engineering'
        }
    };

    // Auto-detect current user from localStorage / DOM if available
    function detectCurrentUser() {
        try {
            const storedName = localStorage.getItem('employee_name') || document.getElementById('userNameDisplay')?.textContent;
            const storedId = localStorage.getItem('employee_uid') || new URLSearchParams(window.location.search).get('id');
            const storedRole = localStorage.getItem('employee_role') || document.getElementById('userRoleDisplay')?.textContent;
            if (storedName && storedName !== '--') state.actor.name = storedName.trim();
            if (storedId) state.actor.id = storedId.trim();
            if (storedRole && storedRole !== '--') state.actor.role = storedRole.trim();
        } catch (e) {
            // ignore
        }
    }

    // Initialize on DOM load
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initEmployeeGoalsApp);
    } else {
        initEmployeeGoalsApp();
    }

    async function initEmployeeGoalsApp() {
        console.log('[EmployeeGoals] Initializing Employee Goal Management Engine...');
        detectCurrentUser();
        bindFilterEvents();
        await Promise.all([
            loadEmployeeGoals(),
            loadEmployeeGoalStats()
        ]);
    }

    /* ─── Load Goals ─── */
    async function loadEmployeeGoals() {
        try {
            const res = await fetch(`${API_BASE}/employee-goals`, { signal: AbortSignal.timeout(2000) });
            if (res.ok) {
                const json = await res.json();
                if (json.success && Array.isArray(json.data) && json.data.length > 0) {
                    state.goals = json.data;
                    saveLocalEmployeeGoals(state.goals);
                    applyGoalFilters();
                    return;
                }
            }
        } catch (err) {
            console.warn('[EmployeeGoals] API unreachable, using local fallback:', err.message);
        }

        // Local fallback
        state.goals = getLocalEmployeeGoals();
        applyGoalFilters();
    }

    /* ─── Goal Stats ─── */
    async function loadEmployeeGoalStats() {
        try {
            const res = await fetch(`${API_BASE}/employee-goals/stats/summary`, { signal: AbortSignal.timeout(2000) });
            if (res.ok) {
                const json = await res.json();
                if (json.success && json.data) {
                    renderEmployeeGoalStats(json.data);
                    return;
                }
            }
        } catch (err) {
            // fallback
        }

        // calculate locally from state.goals
        const goals = state.goals || [];
        const total = goals.length;
        const active = goals.filter(g => g.status === 'active' || g.status === 'in_progress').length;
        const paused = goals.filter(g => g.status === 'paused').length;
        const completed = goals.filter(g => g.status === 'completed').length;
        const avgProgress = total > 0 ? Math.round(goals.reduce((sum, g) => sum + (g.progress || 0), 0) / total) : 0;

        renderEmployeeGoalStats({ total, active, paused, completed, avgProgress });
    }

    function renderEmployeeGoalStats(stats) {
        const setVal = (id, val) => {
            const el = document.getElementById(id);
            if (el) el.textContent = val;
        };

        setVal('statEmpGoalsTotal', stats.total || 0);
        setVal('statEmpGoalsActive', stats.active || 0);
        setVal('statEmpGoalsPaused', stats.paused || 0);
        setVal('statEmpGoalsCompleted', stats.completed || 0);
        setVal('statEmpGoalsAvgProgress', `${stats.avgProgress || 0}%`);
    }

    /* ─── Filtering & Search ─── */
    function applyGoalFilters() {
        let list = [...state.goals];

        if (state.goalFilter !== 'all') {
            list = list.filter(g => g.status === state.goalFilter);
        }

        if (state.goalCategoryFilter !== 'all') {
            list = list.filter(g => (g.category || '').toLowerCase() === state.goalCategoryFilter.toLowerCase());
        }

        if (state.goalSearchQuery) {
            const q = state.goalSearchQuery.toLowerCase();
            list = list.filter(g =>
                (g.title || '').toLowerCase().includes(q) ||
                (g.description || '').toLowerCase().includes(q) ||
                (g.outcome || '').toLowerCase().includes(q)
            );
        }

        state.filteredGoals = list;
        renderEmployeeGoalsGrid();
    }

    function renderEmployeeGoalsGrid() {
        const container = document.getElementById('employeeGoalsContainer');
        if (!container) return;

        if (state.filteredGoals.length === 0) {
            container.innerHTML = `
                <div style="text-align: center; padding: 3.5rem 1rem; color: var(--text-muted); grid-column: 1 / -1; background: white; border-radius: 20px; border: 1.5px dashed var(--border);">
                    <div style="width: 56px; height: 56px; border-radius: 18px; background: var(--primary-light, #fdf2f8); color: var(--primary, #ec4899); display: flex; align-items: center; justify-content: center; margin: 0 auto 12px;">
                        <i data-lucide="target" style="width: 28px; height: 28px;"></i>
                    </div>
                    <h3 style="font-size: 1.15rem; font-weight: 800; color: var(--text-main, #1e0a14); margin-bottom: 6px;">No Goals Found</h3>
                    <p style="font-size: 0.85rem; max-width: 440px; margin: 0 auto 1.5rem; line-height: 1.5;">
                        No goals match your active filters. You can create a personal goal with custom milestones or pick from standardized engineering templates.
                    </p>
                    <div style="display: flex; gap: 10px; justify-content: center; flex-wrap: wrap;">
                        <button onclick="window.openCreateEmployeeGoalModal()" style="background: var(--primary, #ec4899); color: white; border: none; padding: 10px 20px; border-radius: 12px; font-weight: 700; font-size: 0.85rem; cursor: pointer;">
                            + Create My Goal
                        </button>
                        <button onclick="window.openEmployeeTemplatePickerModal()" style="background: white; border: 1.5px solid var(--border); color: var(--text-main); padding: 10px 18px; border-radius: 12px; font-weight: 700; font-size: 0.85rem; cursor: pointer;">
                            Browse Templates
                        </button>
                    </div>
                </div>
            `;
            if (window.lucide) window.lucide.createIcons();
            return;
        }

        container.innerHTML = state.filteredGoals.map(goal => renderGoalCard(goal)).join('');
        if (window.lucide) window.lucide.createIcons();
    }

    function renderGoalCard(goal) {
        const statusColors = {
            active: { bg: '#ecfdf5', text: '#059669', border: '#a7f3d0', label: 'Active / In Progress' },
            in_progress: { bg: '#ecfdf5', text: '#059669', border: '#a7f3d0', label: 'In Progress' },
            paused: { bg: '#fffbeb', text: '#d97706', border: '#fde68a', label: 'Paused' },
            completed: { bg: '#fdf2f8', text: '#be185d', border: '#fbcfe8', label: 'Completed' },
            archived: { bg: '#f1f5f9', text: '#64748b', border: '#cbd5e1', label: 'Archived' }
        };

        const sc = statusColors[goal.status] || statusColors.active;
        const progress = Math.min(100, Math.max(0, goal.progress || 0));

        // Milestones checklist HTML
        let milestonesHtml = '';
        if (goal.measurement?.milestones && goal.measurement.milestones.length > 0) {
            milestonesHtml = `
                <div style="margin-top: 14px; padding-top: 12px; border-top: 1px dashed var(--border, #fce7f3);">
                    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">
                        <span style="font-size: 0.72rem; font-weight: 800; color: var(--text-muted, #9d6e87); text-transform: uppercase; letter-spacing: 0.05em;">Milestones Checklist</span>
                        <span style="font-size: 0.72rem; font-weight: 700; color: var(--primary, #ec4899);">${goal.measurement.milestones.filter(m => m.completed).length}/${goal.measurement.milestones.length} Done</span>
                    </div>
                    <div style="display: flex; flex-direction: column; gap: 6px;">
                        ${goal.measurement.milestones.map(m => `
                            <label style="display: flex; align-items: flex-start; gap: 8px; font-size: 0.82rem; cursor: pointer; color: ${m.completed ? '#9d6e87' : 'var(--text-main, #1e0a14)'}; text-decoration: ${m.completed ? 'line-through' : 'none'};">
                                <input type="checkbox" ${m.completed ? 'checked' : ''} onchange="window.toggleEmployeeMilestone('${goal.id}', '${m.id}')" style="margin-top: 2px; accent-color: var(--primary, #ec4899); cursor: pointer;">
                                <span style="line-height: 1.35;">${escapeHtml(m.title)}</span>
                            </label>
                        `).join('')}
                    </div>
                </div>
            `;
        }

        // Days remaining / Overdue calculation
        let dateBadge = '';
        if (goal.schedule?.targetCompletionDate) {
            const target = new Date(goal.schedule.targetCompletionDate);
            const now = new Date();
            const diffDays = Math.ceil((target - now) / (1000 * 60 * 60 * 24));
            if (goal.status === 'completed') {
                dateBadge = `<span style="font-size: 0.72rem; font-weight: 700; color: #059669; background: #ecfdf5; padding: 3px 8px; border-radius: 8px;">Completed</span>`;
            } else if (diffDays < 0) {
                dateBadge = `<span style="font-size: 0.72rem; font-weight: 700; color: #e11d48; background: #ffe4e6; padding: 3px 8px; border-radius: 8px;">${Math.abs(diffDays)}d Overdue</span>`;
            } else if (diffDays === 0) {
                dateBadge = `<span style="font-size: 0.72rem; font-weight: 700; color: #d97706; background: #fef3c7; padding: 3px 8px; border-radius: 8px;">Due Today</span>`;
            } else {
                dateBadge = `<span style="font-size: 0.72rem; font-weight: 700; color: #64748b; background: #f1f5f9; padding: 3px 8px; border-radius: 8px;">${diffDays}d Remaining</span>`;
            }
        }

        return `
            <div class="employee-goal-card" style="background: white; border-radius: 20px; border: 1.5px solid var(--border, #fce7f3); padding: 1.5rem; display: flex; flex-direction: column; justify-content: space-between; box-shadow: 0 4px 6px -1px rgba(236, 72, 153, 0.05); transition: 0.25s ease;">
                <div>
                    <!-- Top Category & Status Header -->
                    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px; gap: 8px; flex-wrap: wrap;">
                        <span style="font-size: 0.72rem; font-weight: 800; color: var(--primary, #ec4899); background: var(--primary-light, #fdf2f8); border: 1px solid var(--primary-mid, #fbcfe8); padding: 4px 10px; border-radius: 20px; text-transform: uppercase;">
                            ${escapeHtml(goal.category || 'Technical Excellence')}
                        </span>
                        <div style="display: flex; align-items: center; gap: 6px;">
                            ${dateBadge}
                            <span style="font-size: 0.72rem; font-weight: 800; background: ${sc.bg}; color: ${sc.text}; border: 1px solid ${sc.border}; padding: 3px 10px; border-radius: 20px; text-transform: uppercase;">
                                ${sc.label}
                            </span>
                        </div>
                    </div>

                    <!-- Title -->
                    <h3 style="font-size: 1.12rem; font-weight: 800; color: var(--text-main, #1e0a14); margin-bottom: 8px; line-height: 1.35;">
                        ${escapeHtml(goal.title)}
                    </h3>

                    <!-- Outcome Statement (PRD §1.1 Outcome) -->
                    <div style="background: #fffbfe; border-left: 3.5px solid var(--primary, #ec4899); padding: 8px 12px; border-radius: 0 10px 10px 0; margin-bottom: 12px;">
                        <div style="font-size: 0.68rem; font-weight: 800; color: var(--primary-dark, #be185d); text-transform: uppercase; margin-bottom: 2px;">
                            🎯 Desired Outcome
                        </div>
                        <p style="font-size: 0.83rem; color: var(--text-main, #1e0a14); margin: 0; line-height: 1.4; font-weight: 500;">
                            ${escapeHtml(goal.outcome || goal.description || 'Deliver target objective.')}
                        </p>
                    </div>

                    <!-- Operational Scope / Description -->
                    ${goal.description && goal.description !== goal.outcome ? `
                        <p style="font-size: 0.8rem; color: var(--text-muted, #9d6e87); margin-bottom: 12px; line-height: 1.45;">
                            ${escapeHtml(goal.description)}
                        </p>
                    ` : ''}

                    <!-- Progress Bar & Target Value (PRD §1.1 Measure & Track) -->
                    <div style="margin-bottom: 12px;">
                        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 5px;">
                            <span style="font-size: 0.75rem; font-weight: 700; color: var(--text-muted, #9d6e87);">
                                Target: ${goal.measurement?.target || 100} ${escapeHtml(goal.measurement?.unit || '%')}
                            </span>
                            <span style="font-size: 0.85rem; font-weight: 800; color: var(--primary-dark, #be185d);">${progress}%</span>
                        </div>
                        <div style="width: 100%; height: 8px; background: #fdf2f8; border-radius: 999px; overflow: hidden; border: 1px solid var(--border, #fce7f3);">
                            <div style="width: ${progress}%; height: 100%; background: linear-gradient(90deg, #ec4899, #be185d); border-radius: 999px; transition: width 0.4s ease;"></div>
                        </div>
                    </div>

                    <!-- Schedule & Owner Info (PRD §1.1 Schedule & Owner) -->
                    <div style="display: flex; justify-content: space-between; align-items: center; font-size: 0.74rem; color: var(--text-muted, #9d6e87); background: #fbfbfc; padding: 6px 10px; border-radius: 10px; border: 1px solid #f1f5f9;">
                        <span><strong style="color: #475569;">Owner:</strong> ${escapeHtml(goal.owner?.name || 'Marry Doe')}</span>
                        <span><strong style="color: #475569;">Target:</strong> ${goal.schedule?.targetCompletionDate || 'Not set'}</span>
                    </div>

                    ${milestonesHtml}
                </div>

                <!-- Footer Action Toolbar (PRD §1.1 Manage & History) -->
                <div style="display: flex; gap: 8px; margin-top: 16px; pt-3; border-top: 1px solid var(--border, #fce7f3); padding-top: 12px; flex-wrap: wrap;">
                    <button onclick="window.openUpdateEmployeeProgressModal('${goal.id}')" style="flex: 1.5; background: var(--primary, #ec4899); color: white; border: none; padding: 8px 12px; border-radius: 10px; font-weight: 700; font-size: 0.78rem; cursor: pointer; display: flex; align-items: center; justify-content: center; gap: 6px;">
                        <i data-lucide="trending-up" style="width: 14px; height: 14px;"></i>
                        <span>Check-in</span>
                    </button>
                    
                    <button onclick="window.openEditEmployeeGoalModal('${goal.id}')" title="Edit Goal" style="background: white; border: 1.5px solid var(--border, #fce7f3); color: var(--text-main); padding: 8px 10px; border-radius: 10px; font-weight: 700; font-size: 0.78rem; cursor: pointer; display: flex; align-items: center; justify-content: center;">
                        <i data-lucide="edit-3" style="width: 14px; height: 14px; color: var(--text-muted);"></i>
                    </button>

                    ${goal.status === 'paused' ? `
                        <button onclick="window.resumeEmployeeGoal('${goal.id}')" title="Resume Goal" style="background: #ecfdf5; border: 1px solid #a7f3d0; color: #059669; padding: 8px 10px; border-radius: 10px; font-weight: 700; font-size: 0.78rem; cursor: pointer;">
                            <i data-lucide="play" style="width: 14px; height: 14px;"></i>
                        </button>
                    ` : (goal.status === 'active' || goal.status === 'in_progress') ? `
                        <button onclick="window.pauseEmployeeGoal('${goal.id}')" title="Pause Goal" style="background: #fffbeb; border: 1px solid #fde68a; color: #d97706; padding: 8px 10px; border-radius: 10px; font-weight: 700; font-size: 0.78rem; cursor: pointer;">
                            <i data-lucide="pause" style="width: 14px; height: 14px;"></i>
                        </button>
                    ` : ''}

                    ${goal.status !== 'completed' ? `
                        <button onclick="window.completeEmployeeGoal('${goal.id}')" title="Mark Completed" style="background: #ecfdf5; border: 1px solid #a7f3d0; color: #059669; padding: 8px 10px; border-radius: 10px; font-weight: 700; font-size: 0.78rem; cursor: pointer;">
                            <i data-lucide="check-circle" style="width: 14px; height: 14px;"></i>
                        </button>
                    ` : ''}

                    <button onclick="window.openEmployeeGoalHistoryModal('${goal.id}')" title="Audit History" style="background: white; border: 1.5px solid var(--border, #fce7f3); color: var(--text-main); padding: 8px 10px; border-radius: 10px; font-weight: 700; font-size: 0.78rem; cursor: pointer;">
                        <i data-lucide="history" style="width: 14px; height: 14px; color: #64748b;"></i>
                    </button>

                    ${goal.status !== 'archived' ? `
                        <button onclick="window.archiveEmployeeGoal('${goal.id}')" title="Archive Goal" style="background: white; border: 1px solid #e2e8f0; color: #94a3b8; padding: 8px 10px; border-radius: 10px; font-weight: 700; font-size: 0.78rem; cursor: pointer;">
                            <i data-lucide="archive" style="width: 14px; height: 14px;"></i>
                        </button>
                    ` : ''}
                </div>
            </div>
        `;
    }

    /* ─── Filter Events ─── */
    function bindFilterEvents() {
        // Status filter tabs
        document.querySelectorAll('.emp-goal-filter-tab').forEach(btn => {
            btn.addEventListener('click', () => {
                document.querySelectorAll('.emp-goal-filter-tab').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                state.goalFilter = btn.dataset.filter || 'all';
                applyGoalFilters();
            });
        });

        // Category filter
        const catSelect = document.getElementById('empGoalCategoryFilter');
        if (catSelect) {
            catSelect.addEventListener('change', (e) => {
                state.goalCategoryFilter = e.target.value;
                applyGoalFilters();
            });
        }

        // Search input
        const searchInput = document.getElementById('empGoalSearchInput');
        if (searchInput) {
            searchInput.addEventListener('input', (e) => {
                state.goalSearchQuery = e.target.value;
                applyGoalFilters();
            });
        }
    }

    /* ─── Toggle Milestone (PRD §1.1 Measure) ─── */
    window.toggleEmployeeMilestone = async function (goalId, milestoneId) {
        const goal = state.goals.find(g => g.id === goalId);
        if (!goal) return;

        const milestone = goal.measurement?.milestones?.find(m => m.id === milestoneId);
        if (!milestone) return;

        milestone.completed = !milestone.completed;
        const now = new Date().toISOString();
        milestone.completedAt = milestone.completed ? now : null;

        // Auto progress recalculation if milestone method
        if (goal.measurement?.method === 'milestone' && goal.measurement.milestones.length > 0) {
            const completedCount = goal.measurement.milestones.filter(m => m.completed).length;
            const total = goal.measurement.milestones.length;
            goal.measurement.current = completedCount;
            goal.progress = Math.round((completedCount / total) * 100);
            if (completedCount === total) {
                goal.status = 'completed';
                goal.schedule.actualCompletionDate = now.split('T')[0];
            }
        }

        // Record history entry
        if (!goal.history) goal.history = [];
        goal.history.unshift({
            id: `hist-${Date.now()}-milestone`,
            timestamp: now,
            actor: { id: state.actor.id, name: state.actor.name, role: state.actor.role },
            action: 'milestone_toggled',
            summary: `Milestone "${milestone.title}" marked as ${milestone.completed ? 'Completed' : 'Pending'}.`,
            newState: { milestoneId, completed: milestone.completed, progress: goal.progress }
        });
        goal.updatedAt = now;

        saveLocalEmployeeGoals(state.goals);
        loadEmployeeGoalStats();
        applyGoalFilters();

        // Sync with backend API
        try {
            await fetch(`${API_BASE}/employee-goals/${goalId}/milestones/${milestoneId}/toggle`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ actor: state.actor })
            });
        } catch (e) {
            // Local state already updated
        }
    };

    /* ─── Create / Edit Goal Modal (PRD §1.1 Create & Manage) ─── */
    window.openCreateEmployeeGoalModal = function (prefill = null) {
        state.currentGoalId = null;
        document.getElementById('empGoalModalTitle').textContent = 'Create Employee Goal (PRD §1.1)';
        document.getElementById('empGoalModalSubmitBtn').textContent = 'Create Goal';
        document.getElementById('empGoalFormId').value = '';

        document.getElementById('empGoalFormTitle').value = prefill?.title || '';
        document.getElementById('empGoalFormCategory').value = prefill?.category || 'Technical Excellence';
        document.getElementById('empGoalFormOutcome').value = prefill?.outcome || '';
        document.getElementById('empGoalFormDesc').value = prefill?.description || '';
        document.getElementById('empGoalFormMethod').value = prefill?.measurement?.method || 'quantitative';
        document.getElementById('empGoalFormTarget').value = prefill?.measurement?.target !== undefined ? prefill.measurement.target : 100;
        document.getElementById('empGoalFormUnit').value = prefill?.measurement?.unit || '%';
        document.getElementById('empGoalFormCriteria').value = prefill?.measurement?.completionCriteria || '';
        
        const todayStr = new Date().toISOString().split('T')[0];
        document.getElementById('empGoalFormStartDate').value = prefill?.schedule?.startDate || todayStr;
        document.getElementById('empGoalFormTargetDate').value = prefill?.schedule?.targetCompletionDate || '';

        renderMilestoneInputs(prefill?.measurement?.milestones || [
            { title: 'Phase 1: Architecture scoping & setup' },
            { title: 'Phase 2: Core implementation & test verification' },
            { title: 'Phase 3: Production sign-off & rollout' }
        ]);

        document.getElementById('employeeGoalModal').style.display = 'flex';
        if (window.lucide) window.lucide.createIcons();
    };

    window.openEditEmployeeGoalModal = function (goalId) {
        const goal = state.goals.find(g => g.id === goalId);
        if (!goal) return;
        state.currentGoalId = goalId;
        document.getElementById('empGoalModalTitle').textContent = `Edit Goal: ${goal.title}`;
        document.getElementById('empGoalModalSubmitBtn').textContent = 'Save Changes';
        document.getElementById('empGoalFormId').value = goal.id;

        document.getElementById('empGoalFormTitle').value = goal.title;
        document.getElementById('empGoalFormCategory').value = goal.category;
        document.getElementById('empGoalFormOutcome').value = goal.outcome || '';
        document.getElementById('empGoalFormDesc').value = goal.description || '';
        document.getElementById('empGoalFormMethod').value = goal.measurement?.method || 'quantitative';
        document.getElementById('empGoalFormTarget').value = goal.measurement?.target || 100;
        document.getElementById('empGoalFormUnit').value = goal.measurement?.unit || '%';
        document.getElementById('empGoalFormCriteria').value = goal.measurement?.completionCriteria || '';
        document.getElementById('empGoalFormStartDate').value = goal.schedule?.startDate || '';
        document.getElementById('empGoalFormTargetDate').value = goal.schedule?.targetCompletionDate || '';

        renderMilestoneInputs(goal.measurement?.milestones || []);

        document.getElementById('employeeGoalModal').style.display = 'flex';
        if (window.lucide) window.lucide.createIcons();
    };

    window.closeEmployeeGoalModal = function () {
        document.getElementById('employeeGoalModal').style.display = 'none';
    };

    function renderMilestoneInputs(milestones = []) {
        const container = document.getElementById('empGoalFormMilestonesContainer');
        if (!container) return;

        container.innerHTML = milestones.map((m, idx) => `
            <div class="milestone-row" style="display: flex; gap: 8px; align-items: center; margin-bottom: 6px;">
                <span style="font-size: 0.75rem; font-weight: 800; color: var(--text-muted); width: 20px;">#${idx + 1}</span>
                <input type="text" class="milestone-input" value="${escapeHtml(m.title || '')}" placeholder="Milestone outcome or deliverable..." style="flex: 1; padding: 8px 12px; border-radius: 10px; border: 1.5px solid var(--border); font-size: 0.82rem; outline: none; background: #fffbfe;">
                <button type="button" onclick="this.parentElement.remove()" style="background: none; border: none; color: #ef4444; cursor: pointer; padding: 4px;">
                    <i data-lucide="trash-2" style="width: 14px; height: 14px;"></i>
                </button>
            </div>
        `).join('');

        if (window.lucide) window.lucide.createIcons();
    }

    window.addEmployeeMilestoneInputRow = function () {
        const container = document.getElementById('empGoalFormMilestonesContainer');
        const count = container.querySelectorAll('.milestone-row').length + 1;
        const row = document.createElement('div');
        row.className = 'milestone-row';
        row.style.cssText = 'display: flex; gap: 8px; align-items: center; margin-bottom: 6px;';
        row.innerHTML = `
            <span style="font-size: 0.75rem; font-weight: 800; color: var(--text-muted); width: 20px;">#${count}</span>
            <input type="text" class="milestone-input" placeholder="Milestone outcome or deliverable..." style="flex: 1; padding: 8px 12px; border-radius: 10px; border: 1.5px solid var(--border); font-size: 0.82rem; outline: none; background: #fffbfe;">
            <button type="button" onclick="this.parentElement.remove()" style="background: none; border: none; color: #ef4444; cursor: pointer; padding: 4px;">
                <i data-lucide="trash-2" style="width: 14px; height: 14px;"></i>
            </button>
        `;
        container.appendChild(row);
        if (window.lucide) window.lucide.createIcons();
    };

    window.handleEmployeeGoalFormSubmit = async function (e) {
        e.preventDefault();

        const goalId = document.getElementById('empGoalFormId').value;
        const title = document.getElementById('empGoalFormTitle').value.trim();
        const category = document.getElementById('empGoalFormCategory').value;
        const outcome = document.getElementById('empGoalFormOutcome').value.trim();
        const description = document.getElementById('empGoalFormDesc').value.trim();
        const method = document.getElementById('empGoalFormMethod').value;
        const target = parseFloat(document.getElementById('empGoalFormTarget').value) || 100;
        const unit = document.getElementById('empGoalFormUnit').value.trim() || '%';
        const completionCriteria = document.getElementById('empGoalFormCriteria').value.trim();
        const startDate = document.getElementById('empGoalFormStartDate').value;
        const targetCompletionDate = document.getElementById('empGoalFormTargetDate').value;

        // Gather milestones
        const milestoneInputs = document.querySelectorAll('#empGoalFormMilestonesContainer .milestone-input');
        const milestones = [];
        milestoneInputs.forEach((inp, idx) => {
            const val = inp.value.trim();
            if (val) {
                milestones.push({
                    id: `m_${idx + 1}`,
                    title: val,
                    completed: false,
                    targetDate: targetCompletionDate || null
                });
            }
        });

        const now = new Date().toISOString();

        if (goalId) {
            // Edit existing
            const goal = state.goals.find(g => g.id === goalId);
            if (goal) {
                const prev = { title: goal.title, outcome: goal.outcome, target: goal.measurement?.target };
                goal.title = title;
                goal.category = category;
                goal.outcome = outcome;
                goal.description = description;
                goal.measurement = {
                    ...goal.measurement,
                    method,
                    target,
                    unit,
                    completionCriteria,
                    milestones: milestones.length > 0 ? milestones : goal.measurement.milestones
                };
                goal.schedule = {
                    ...goal.schedule,
                    startDate,
                    targetCompletionDate
                };
                goal.updatedAt = now;

                if (!goal.history) goal.history = [];
                goal.history.unshift({
                    id: `hist-${Date.now()}-edit`,
                    timestamp: now,
                    actor: { id: state.actor.id, name: state.actor.name, role: state.actor.role },
                    action: 'edited',
                    summary: `Goal configuration revised by ${state.actor.name}.`,
                    previousState: prev,
                    newState: { title, outcome, target }
                });

                saveLocalEmployeeGoals(state.goals);
                applyGoalFilters();
                loadEmployeeGoalStats();
                closeEmployeeGoalModal();

                try {
                    await fetch(`${API_BASE}/employee-goals/${goalId}`, {
                        method: 'PUT',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ updates: goal, actor: state.actor })
                    });
                } catch (err) {}
            }
        } else {
            // Create new
            const newId = `EMP-GOAL-${Date.now()}-${Math.random().toString(36).substring(2, 7).toUpperCase()}`;
            const newGoal = {
                id: newId,
                title,
                category,
                outcome,
                description,
                owner: {
                    id: state.actor.id,
                    name: state.actor.name,
                    role: state.actor.role,
                    email: state.actor.email,
                    department: state.actor.department
                },
                measurement: {
                    method,
                    target,
                    current: 0,
                    unit,
                    completionCriteria: completionCriteria || 'Complete all deliverables on schedule.',
                    milestones
                },
                schedule: {
                    startDate,
                    targetCompletionDate,
                    actualCompletionDate: null
                },
                progress: 0,
                status: 'active',
                createdAt: now,
                updatedAt: now,
                history: [
                    {
                        id: `hist-${Date.now()}-init`,
                        timestamp: now,
                        actor: { id: state.actor.id, name: state.actor.name, role: state.actor.role },
                        action: 'created',
                        summary: `Goal "${title}" created with target ${target} ${unit}.`,
                        notes: 'Initial employee goal configuration.'
                    }
                ]
            };

            state.goals.unshift(newGoal);
            saveLocalEmployeeGoals(state.goals);
            applyGoalFilters();
            loadEmployeeGoalStats();
            closeEmployeeGoalModal();

            try {
                await fetch(`${API_BASE}/employee-goals`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ ...newGoal, actor: state.actor })
                });
            } catch (err) {}
        }
    };

    /* ─── Progress Check-in Modal (PRD §1.1 Track) ─── */
    window.openUpdateEmployeeProgressModal = function (goalId) {
        const goal = state.goals.find(g => g.id === goalId);
        if (!goal) return;

        state.currentGoalId = goalId;
        document.getElementById('empProgressGoalTitle').textContent = goal.title;
        document.getElementById('empProgressSlider').value = goal.progress || 0;
        document.getElementById('empProgressValueDisplay').textContent = `${goal.progress || 0}%`;
        document.getElementById('empProgressMetricUnitLabel').textContent = goal.measurement?.unit || '%';
        document.getElementById('empProgressCurrentMetric').value = goal.measurement?.current !== undefined ? goal.measurement.current : goal.progress;
        document.getElementById('empProgressCheckInNote').value = '';

        document.getElementById('employeeProgressModal').style.display = 'flex';
        if (window.lucide) window.lucide.createIcons();
    };

    window.closeUpdateEmployeeProgressModal = function () {
        document.getElementById('employeeProgressModal').style.display = 'none';
    };

    window.handleEmployeeProgressSliderInput = function (val) {
        document.getElementById('empProgressValueDisplay').textContent = `${val}%`;
    };

    window.submitEmployeeGoalProgressUpdate = async function () {
        const goalId = state.currentGoalId;
        const goal = state.goals.find(g => g.id === goalId);
        if (!goal) return;

        const newProg = parseInt(document.getElementById('empProgressSlider').value, 10);
        const metricVal = parseFloat(document.getElementById('empProgressCurrentMetric').value);
        const note = document.getElementById('empProgressCheckInNote').value.trim();
        const prevProg = goal.progress;

        goal.progress = newProg;
        if (!isNaN(metricVal)) {
            goal.measurement.current = metricVal;
        }

        let autoCompleted = false;
        if (newProg === 100 && (goal.status === 'active' || goal.status === 'in_progress')) {
            goal.status = 'completed';
            goal.schedule.actualCompletionDate = new Date().toISOString().split('T')[0];
            autoCompleted = true;
        }

        const now = new Date().toISOString();
        goal.updatedAt = now;

        if (!goal.history) goal.history = [];
        goal.history.unshift({
            id: `hist-${Date.now()}-prog`,
            timestamp: now,
            actor: { id: state.actor.id, name: state.actor.name, role: state.actor.role },
            action: 'progress_updated',
            summary: `Progress updated from ${prevProg}% to ${newProg}%${autoCompleted ? ' (Marked as Completed)' : ''}.`,
            previousState: { progress: prevProg },
            newState: { progress: newProg, status: goal.status },
            notes: note || 'Progress check-in logged.'
        });

        saveLocalEmployeeGoals(state.goals);
        loadEmployeeGoalStats();
        applyGoalFilters();
        closeUpdateEmployeeProgressModal();

        try {
            await fetch(`${API_BASE}/employee-goals/${goalId}/progress`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ progress: newProg, notes: note, actor: state.actor, currentValue: metricVal })
            });
        } catch (e) {}
    };

    /* ─── Lifecycle State Actions: Pause, Resume, Complete, Archive (PRD §1.1 Manage) ─── */
    window.pauseEmployeeGoal = async function (goalId) {
        updateGoalStatus(goalId, 'paused', 'Goal paused by employee.');
    };

    window.resumeEmployeeGoal = async function (goalId) {
        updateGoalStatus(goalId, 'active', 'Goal execution resumed.');
    };

    window.completeEmployeeGoal = async function (goalId) {
        updateGoalStatus(goalId, 'completed', 'Goal marked as 100% completed.');
    };

    window.archiveEmployeeGoal = async function (goalId) {
        if (!confirm('Are you sure you want to archive this goal?')) return;
        updateGoalStatus(goalId, 'archived', 'Goal archived.');
    };

    async function updateGoalStatus(goalId, newStatus, note) {
        const goal = state.goals.find(g => g.id === goalId);
        if (!goal) return;

        const prev = goal.status;
        goal.status = newStatus;
        const now = new Date().toISOString();
        goal.updatedAt = now;

        if (newStatus === 'completed') {
            goal.progress = 100;
            goal.schedule.actualCompletionDate = now.split('T')[0];
        }

        if (!goal.history) goal.history = [];
        goal.history.unshift({
            id: `hist-${Date.now()}-status`,
            timestamp: now,
            actor: { id: state.actor.id, name: state.actor.name, role: state.actor.role },
            action: newStatus,
            summary: `Status transitioned from "${prev}" to "${newStatus}".`,
            previousState: { status: prev },
            newState: { status: newStatus },
            notes: note
        });

        saveLocalEmployeeGoals(state.goals);
        loadEmployeeGoalStats();
        applyGoalFilters();

        try {
            await fetch(`${API_BASE}/employee-goals/${goalId}/status`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ status: newStatus, reason: note, actor: state.actor })
            });
        } catch (e) {}
    }

    /* ─── Audit Trail History Viewer (PRD §1.1 History) ─── */
    window.openEmployeeGoalHistoryModal = function (goalId) {
        const goal = state.goals.find(g => g.id === goalId);
        if (!goal) return;

        document.getElementById('empGoalHistoryTitle').textContent = `Audit Trail: ${goal.title}`;
        const timeline = document.getElementById('empGoalHistoryTimeline');
        const history = [...(goal.history || [])].sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

        if (history.length === 0) {
            timeline.innerHTML = `<p style="color: var(--text-muted); font-size: 0.85rem; text-align: center; padding: 2rem 0;">No audit history recorded yet.</p>`;
        } else {
            const actionIcons = {
                created: { icon: 'plus-circle', color: '#10b981', bg: '#ecfdf5', title: 'Goal Created' },
                edited: { icon: 'edit-3', color: '#2563eb', bg: '#eff6ff', title: 'Goal Edited' },
                progress_updated: { icon: 'trending-up', color: '#ec4899', bg: '#fdf2f8', title: 'Progress Check-in' },
                milestone_toggled: { icon: 'check-square', color: '#8b5cf6', bg: '#f5f3ff', title: 'Milestone Updated' },
                paused: { icon: 'pause-circle', color: '#f59e0b', bg: '#fffbeb', title: 'Goal Paused' },
                completed: { icon: 'check-circle-2', color: '#10b981', bg: '#ecfdf5', title: 'Goal Completed' },
                archived: { icon: 'archive', color: '#64748b', bg: '#f1f5f9', title: 'Goal Archived' },
                note_added: { icon: 'message-circle', color: '#06b6d4', bg: '#ecfeff', title: 'Note Added' }
            };

            timeline.innerHTML = history.map((item, idx) => {
                const conf = actionIcons[item.action] || { icon: 'clock', color: '#64748b', bg: '#f1f5f9', title: item.action };
                const formattedDate = new Date(item.timestamp).toLocaleString();

                return `
                    <div style="display: flex; gap: 14px; position: relative; padding-bottom: 20px;">
                        ${idx < history.length - 1 ? '<div style="position: absolute; left: 18px; top: 36px; bottom: 0; width: 2px; background: var(--border, #fce7f3);"></div>' : ''}
                        
                        <div style="width: 36px; height: 36px; border-radius: 10px; background: ${conf.bg}; color: ${conf.color}; display: flex; align-items: center; justify-content: center; flex-shrink: 0; z-index: 1;">
                            <i data-lucide="${conf.icon}" style="width: 18px; height: 18px;"></i>
                        </div>

                        <div style="flex: 1; background: #fffbfe; border: 1px solid var(--border, #fce7f3); border-radius: 12px; padding: 12px;">
                            <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 4px; flex-wrap: wrap; gap: 6px;">
                                <span style="font-size: 0.82rem; font-weight: 800; color: var(--text-main, #1e0a14);">${conf.title}</span>
                                <span style="font-size: 0.72rem; color: var(--text-muted, #9d6e87); font-weight: 600;">${formattedDate}</span>
                            </div>
                            
                            <p style="font-size: 0.8rem; color: var(--text-main, #1e0a14); margin: 0 0 6px; line-height: 1.4;">
                                ${escapeHtml(item.summary || '')}
                            </p>

                            ${item.notes ? `
                                <div style="font-size: 0.75rem; color: var(--text-muted, #9d6e87); background: white; padding: 6px 10px; border-radius: 8px; border: 1px solid #fce7f3; margin-top: 4px; font-style: italic;">
                                    "${escapeHtml(item.notes)}"
                                </div>
                            ` : ''}

                            <div style="font-size: 0.7rem; color: #94a3b8; margin-top: 6px; display: flex; align-items: center; gap: 6px;">
                                <i data-lucide="user" style="width: 12px; height: 12px;"></i>
                                <span>Logged by: <strong>${escapeHtml(item.actor?.name || 'Employee')}</strong> (${escapeHtml(item.actor?.role || 'Staff')})</span>
                            </div>
                        </div>
                    </div>
                `;
            }).join('');
        }

        document.getElementById('employeeGoalHistoryModal').style.display = 'flex';
        if (window.lucide) window.lucide.createIcons();
    };

    window.closeEmployeeGoalHistoryModal = function () {
        document.getElementById('employeeGoalHistoryModal').style.display = 'none';
    };

    /* ─── Template Picker Modal ─── */
    window.openEmployeeTemplatePickerModal = function () {
        const container = document.getElementById('empTemplatePickerList');
        if (!container) return;

        container.innerHTML = STANDARD_EMPLOYEE_TEMPLATES.map(tpl => `
            <div style="background: white; border: 1.5px solid var(--border, #fce7f3); border-radius: 14px; padding: 14px; display: flex; justify-content: space-between; align-items: center; gap: 12px; transition: 0.2s;" onmouseover="this.style.borderColor='var(--primary)'" onmouseout="this.style.borderColor='var(--border)'">
                <div>
                    <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 4px;">
                        <span style="font-size: 0.7rem; font-weight: 800; color: var(--primary); background: var(--primary-light); padding: 2px 8px; border-radius: 6px; text-transform: uppercase;">${escapeHtml(tpl.category)}</span>
                        <h4 style="font-size: 0.95rem; font-weight: 800; margin: 0; color: var(--text-main);">${escapeHtml(tpl.name)}</h4>
                    </div>
                    <p style="font-size: 0.78rem; color: var(--text-muted); margin: 0 0 4px; line-height: 1.35;">${escapeHtml(tpl.description)}</p>
                    <div style="font-size: 0.74rem; color: var(--primary-dark); font-weight: 600;">🎯 Outcome: ${escapeHtml(tpl.outcome)}</div>
                </div>
                <button onclick="window.instantiateEmployeeTemplate('${tpl.id}')" style="background: var(--primary, #ec4899); color: white; border: none; padding: 8px 14px; border-radius: 10px; font-weight: 700; font-size: 0.8rem; cursor: pointer; flex-shrink: 0; white-space: nowrap;">
                    Use Template
                </button>
            </div>
        `).join('');

        document.getElementById('employeeTemplatePickerModal').style.display = 'flex';
        if (window.lucide) window.lucide.createIcons();
    };

    window.closeEmployeeTemplatePickerModal = function () {
        document.getElementById('employeeTemplatePickerModal').style.display = 'none';
    };

    window.instantiateEmployeeTemplate = function (templateId) {
        const tpl = STANDARD_EMPLOYEE_TEMPLATES.find(t => t.id === templateId);
        if (!tpl) return;
        closeEmployeeTemplatePickerModal();
        openCreateEmployeeGoalModal({
            title: tpl.name,
            category: tpl.category,
            description: tpl.description,
            outcome: tpl.outcome,
            measurement: tpl.measurement,
            milestones: tpl.milestones
        });
    };

    function escapeHtml(str) {
        if (!str) return '';
        return String(str)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }
})();
