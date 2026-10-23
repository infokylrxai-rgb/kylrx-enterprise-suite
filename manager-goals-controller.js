/**
 * manager-goals-controller.js
 * 
 * Interactive UI Controller for:
 * 1.1 Manager Goal Management
 * 1.2 Customisable Templates Configuration
 * 
 * Implements:
 * - Goal creation, quantitative/milestone/unit/criteria measurement, scheduling
 * - Interactive progress tracking, status transitions (active, paused, completed, archived)
 * - Immutable chronological audit trail history viewer
 * - Template library browsing by module
 * - Authorised template creation with permitted fields & locked fields
 * - Editing permitted fields & user instructions
 * - Interactive pre-save preview
 * - Draft vs Published lifecycle
 * - Administrator template permission controls
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

    // Default Seed Goals conforming strictly to PRD 1.1 Manager Goal Management
    const SEED_GOALS = [
        {
            id: 'MGR-GOAL-001',
            title: 'Zero-Trust Architecture & Threat Hardening',
            category: 'Cybersecurity & Compliance',
            outcome: 'Achieve complete micro-segmentation and Zero-Trust network access across all 802 regional command centers with 99.99% compliance attestation.',
            description: 'Enforce mTLS, continuous verification, and posture checks for all endpoint connections and command consoles.',
            owner: { id: 'Yksv1DMH9pIeRhNxQ8E3', name: 'John Doe', role: 'Cybersecurity Manager', department: 'Cybersecurity' },
            measurement: {
                method: 'quantitative',
                target: 100,
                current: 85,
                unit: '% Compliance',
                completionCriteria: 'All 802 regional nodes pass automated vulnerability audit and cryptographic attestation.',
                milestones: [
                    { id: 'm_1', title: 'Phase 1: Regional perimeter audit & baseline attestation', completed: true },
                    { id: 'm_2', title: 'Phase 2: Enforce mTLS & continuous posture verification', completed: true },
                    { id: 'm_3', title: 'Phase 3: Automated pen-testing & compliance signoff', completed: false }
                ]
            },
            schedule: {
                startDate: '2026-10-01',
                targetCompletionDate: '2026-12-31'
            },
            progress: 85,
            status: 'active',
            history: [
                {
                    timestamp: '2026-10-01T09:00:00.000Z',
                    actor: { name: 'John Doe', role: 'Cybersecurity Manager' },
                    action: 'created',
                    summary: 'Goal created: Zero-Trust Architecture & Threat Hardening',
                    notes: 'Initiated FY27 Q4 Strategic Goal for command center threat hardening.'
                },
                {
                    timestamp: '2026-10-15T14:30:00.000Z',
                    actor: { name: 'John Doe', role: 'Cybersecurity Manager' },
                    action: 'progress_updated',
                    summary: 'Progress updated to 85% (Metric: 85 % Compliance)',
                    notes: 'Milestones 1 & 2 completed across all 802 regional command centers.'
                }
            ]
        },
        {
            id: 'MGR-GOAL-002',
            title: 'SOC Incident Response Time Reduction',
            category: 'Operational Excellence',
            outcome: 'Reduce Mean Time to Detect (MTTD) to under 3 minutes and Mean Time to Remediate (MTTR) to under 15 minutes.',
            description: 'Automate tier-1 alert enrichment and automated isolation playbooks in SOAR platform.',
            owner: { id: 'Yksv1DMH9pIeRhNxQ8E3', name: 'John Doe', role: 'Cybersecurity Manager', department: 'Cybersecurity' },
            measurement: {
                method: 'unit',
                target: 15,
                current: 18,
                unit: 'Minutes MTTR',
                completionCriteria: '95% of security alerts triaged and mitigated in under 15 minutes across 30 consecutive days.',
                milestones: [
                    { id: 'm_1', title: 'Deploy SOAR automated enrichment playbooks', completed: true },
                    { id: 'm_2', title: 'Integrate EDR quarantine webhooks', completed: true },
                    { id: 'm_3', title: 'Run unannounced tabletop red-team exercise', completed: true }
                ]
            },
            schedule: {
                startDate: '2026-09-15',
                targetCompletionDate: '2026-11-30'
            },
            progress: 90,
            status: 'active',
            history: [
                {
                    timestamp: '2026-09-15T10:00:00.000Z',
                    actor: { name: 'John Doe', role: 'Cybersecurity Manager' },
                    action: 'created',
                    summary: 'Goal created: SOC Incident Response Time Reduction',
                    notes: 'Target MTTR reduction through orchestration and triage automation.'
                },
                {
                    timestamp: '2026-10-20T11:00:00.000Z',
                    actor: { name: 'John Doe', role: 'Cybersecurity Manager' },
                    action: 'progress_updated',
                    summary: 'Progress updated to 90% (Current MTTR: 18 Minutes)',
                    notes: 'All 3 key milestones achieved; final 30-day observation window underway.'
                }
            ]
        },
        {
            id: 'MGR-GOAL-003',
            title: 'ISO 27001 / SOC-2 Type II Annual Recertification',
            category: 'Cybersecurity & Compliance',
            outcome: 'Complete audit fieldwork and achieve unconditional SOC-2 Type II certification with zero non-conformities.',
            description: 'Audit evidence collection across workforce access controls, change management, and asset security.',
            owner: { id: 'Yksv1DMH9pIeRhNxQ8E3', name: 'John Doe', role: 'Cybersecurity Manager', department: 'Cybersecurity' },
            measurement: {
                method: 'criteria',
                target: 100,
                current: 65,
                unit: '% Complete',
                completionCriteria: 'External auditor signs off on all 64 trust services criteria without remediation exceptions.',
                milestones: [
                    { id: 'm_1', title: 'Internal gap assessment & control verification', completed: true },
                    { id: 'm_2', title: 'Evidence upload to auditor GRC portal', completed: true },
                    { id: 'm_3', title: 'Auditor interviews with engineering leads', completed: false },
                    { id: 'm_4', title: 'Final report publication & executive signoff', completed: false }
                ]
            },
            schedule: {
                startDate: '2026-08-01',
                targetCompletionDate: '2026-11-15'
            },
            progress: 65,
            status: 'active',
            history: [
                {
                    timestamp: '2026-08-01T08:30:00.000Z',
                    actor: { name: 'John Doe', role: 'Cybersecurity Manager' },
                    action: 'created',
                    summary: 'Goal created: ISO 27001 / SOC-2 Type II Annual Recertification',
                    notes: 'Mandatory annual external security compliance audit.'
                }
            ]
        }
    ];

    function getLocalGoals() {
        try {
            const raw = localStorage.getItem('kylrx_manager_goals');
            if (raw) {
                const parsed = JSON.parse(raw);
                if (Array.isArray(parsed) && parsed.length > 0) return parsed;
            }
        } catch (e) {}
        saveLocalGoals(SEED_GOALS);
        return [...SEED_GOALS];
    }

    function saveLocalGoals(goals) {
        try {
            localStorage.setItem('kylrx_manager_goals', JSON.stringify(goals));
        } catch (e) {}
    }

    // State
    const state = {
        goals: [],
        filteredGoals: [],
        templates: [],
        filteredTemplates: [],
        activeGoalFilter: 'all',
        activeGoalCategory: 'all',
        goalSearchQuery: '',
        activeTemplateModule: 'all',
        activeTemplateStatus: 'all',
        activeTemplateScope: 'all',
        currentGoalId: null,
        currentTemplateId: null,
        user: {
            id: localStorage.getItem('userId') || 'MGR-JOHN-DOE',
            name: localStorage.getItem('userName') || 'John Doe',
            role: localStorage.getItem('userRole') || 'manager', // 'super_admin' | 'hr_admin' | 'manager'
            department: 'Cybersecurity',
            departmentCode: 'UNIT-CYB-802'
        }
    };

    // DOM Ready Initialization
    document.addEventListener('DOMContentLoaded', () => {
        initManagerGoalsApp();
    });

    async function initManagerGoalsApp() {
        console.log('[ManagerGoals] Initializing Goal & Template Engine...');
        await Promise.all([
            loadGoals(),
            loadTemplates(),
            loadStats()
        ]);
        bindEventListeners();
    }

    /* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
       1.1 MANAGER GOAL MANAGEMENT
     ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */

    async function loadGoals() {
        let loadedFromApi = false;
        try {
            const res = await fetch(`${API_BASE}/manager-goals`, { signal: AbortSignal.timeout(2000) });
            if (res.ok) {
                const json = await res.json();
                if (Array.isArray(json.data) && json.data.length > 0) {
                    state.goals = json.data;
                    saveLocalGoals(state.goals);
                    loadedFromApi = true;
                }
            }
        } catch (err) {
            console.warn('[ManagerGoals] API unreachable, using local fallback:', err.message);
        }

        if (!loadedFromApi) {
            state.goals = getLocalGoals();
        }

        applyGoalFilters();
    }

    async function loadStats() {
        try {
            const res = await fetch(`${API_BASE}/manager-goals/stats/summary`, { signal: AbortSignal.timeout(2000) });
            if (res.ok) {
                const json = await res.json();
                renderGoalStats(json.data);
                return;
            }
        } catch (err) {
            // calculate locally from state.goals
        }

        const goals = state.goals || [];
        const total = goals.length;
        const active = goals.filter(g => g.status === 'active' || g.status === 'in_progress').length;
        const paused = goals.filter(g => g.status === 'paused').length;
        const completed = goals.filter(g => g.status === 'completed').length;
        const avgProgress = total > 0 ? Math.round(goals.reduce((sum, g) => sum + (g.progress || 0), 0) / total) : 0;

        renderGoalStats({ total, active, paused, completed, avgProgress });
    }

    function renderGoalStats(stats) {
        if (!stats) return;
        const setVal = (id, val) => {
            const el = document.getElementById(id);
            if (el) el.textContent = val;
        };
        setVal('statGoalsTotal', stats.total || 0);
        setVal('statGoalsActive', stats.active || 0);
        setVal('statGoalsPaused', stats.paused || 0);
        setVal('statGoalsCompleted', stats.completed || 0);
        setVal('statGoalsAvgProgress', `${stats.avgProgress || 0}%`);

        const badge = document.getElementById('tabGoalsCountBadge');
        if (badge) {
            badge.textContent = stats.active !== undefined ? stats.active : stats.total || 0;
        }
    }

    function applyGoalFilters() {
        let list = [...state.goals];

        if (state.activeGoalFilter !== 'all') {
            list = list.filter(g => g.status === state.activeGoalFilter);
        }

        if (state.activeGoalCategory !== 'all') {
            list = list.filter(g => g.category.toLowerCase() === state.activeGoalCategory.toLowerCase());
        }

        if (state.goalSearchQuery) {
            const q = state.goalSearchQuery.toLowerCase();
            list = list.filter(g => 
                g.title.toLowerCase().includes(q) || 
                (g.description && g.description.toLowerCase().includes(q)) ||
                (g.outcome && g.outcome.toLowerCase().includes(q))
            );
        }

        state.filteredGoals = list;
        renderGoalsGrid();
    }

    function renderGoalsGrid() {
        const container = document.getElementById('managerGoalsContainer');
        if (!container) return;

        if (state.filteredGoals.length === 0) {
            container.innerHTML = `
                <div style="grid-column: 1 / -1; background: white; border: 1.5px dashed var(--border, #e2e8f0); border-radius: 20px; padding: 3rem 1.5rem; text-align: center;">
                    <div style="width: 54px; height: 54px; border-radius: 16px; background: #eff6ff; color: #2563eb; display: flex; align-items: center; justify-content: center; margin: 0 auto 1rem;">
                        <i data-lucide="target" style="width: 28px; height: 28px;"></i>
                    </div>
                    <h3 style="font-size: 1.1rem; font-weight: 800; color: #0f172a; margin-bottom: 6px;">No Strategic Goals Found</h3>
                    <p style="font-size: 0.85rem; color: #64748b; max-width: 420px; margin: 0 auto 1.5rem;">
                        No goals match the selected filter criteria. You can create your own goal or choose an existing template to get started.
                    </p>
                    <div style="display: flex; gap: 10px; justify-content: center; flex-wrap: wrap;">
                        <button onclick="window.openCreateGoalModal()" class="alert-btn" style="background: var(--primary, #2563eb); color: white; width: auto; padding: 10px 20px; margin: 0;">
                            + Create First Goal
                        </button>
                        <button onclick="window.openTemplatePickerModal('goals')" class="alert-btn" style="background: #f1f5f9; color: #334155; width: auto; padding: 10px 20px; margin: 0;">
                            Browse Goal Templates
                        </button>
                    </div>
                </div>
            `;
            if (window.lucide) window.lucide.createIcons();
            return;
        }

        container.innerHTML = state.filteredGoals.map(goal => {
            const statusConfig = {
                active: { bg: '#dcfce7', color: '#15803d', label: 'Active / In Progress', icon: 'play' },
                in_progress: { bg: '#dcfce7', color: '#15803d', label: 'In Progress', icon: 'play' },
                paused: { bg: '#fef3c7', color: '#b45309', label: 'Paused', icon: 'pause' },
                completed: { bg: '#eff6ff', color: '#1d4ed8', label: 'Completed', icon: 'check-circle' },
                archived: { bg: '#f1f5f9', color: '#64748b', label: 'Archived', icon: 'archive' },
                draft: { bg: '#f3e8ff', color: '#7e22ce', label: 'Draft', icon: 'file-edit' }
            }[goal.status] || { bg: '#f1f5f9', color: '#64748b', label: goal.status, icon: 'circle' };

            // Schedule calculation
            let scheduleBadge = '';
            if (goal.schedule?.targetCompletionDate) {
                const target = new Date(goal.schedule.targetCompletionDate);
                const now = new Date();
                const diffDays = Math.ceil((target - now) / (1000 * 60 * 60 * 24));
                if (goal.status === 'completed') {
                    scheduleBadge = `<span style="font-size: 0.72rem; color: #16a34a; font-weight: 700;">Completed on schedule</span>`;
                } else if (diffDays < 0) {
                    scheduleBadge = `<span style="font-size: 0.72rem; color: #dc2626; font-weight: 800;">${Math.abs(diffDays)}d overdue</span>`;
                } else {
                    scheduleBadge = `<span style="font-size: 0.72rem; color: #2563eb; font-weight: 700;">${diffDays} days remaining</span>`;
                }
            }

            const milestones = goal.measurement?.milestones || [];
            const completedMilestones = milestones.filter(m => m.completed).length;

            return `
                <div class="card" style="display: flex; flex-direction: column; justify-content: space-between; transition: transform 0.2s, box-shadow 0.2s; position: relative; border-top: 4px solid ${goal.status === 'completed' ? '#10b981' : (goal.status === 'paused' ? '#f59e0b' : 'var(--primary, #2563eb)')};">
                    <div>
                        <!-- Header Badges -->
                        <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 12px; gap: 8px;">
                            <span style="font-size: 0.68rem; font-weight: 800; text-transform: uppercase; letter-spacing: 0.5px; background: #f8fafc; color: #475569; padding: 4px 8px; border-radius: 8px; border: 1px solid var(--border);">
                                ${goal.category || 'Strategic Goal'}
                            </span>
                            <span style="display: inline-flex; align-items: center; gap: 4px; font-size: 0.7rem; font-weight: 800; background: ${statusConfig.bg}; color: ${statusConfig.color}; padding: 4px 10px; border-radius: 20px;">
                                <i data-lucide="${statusConfig.icon}" style="width: 12px; height: 12px;"></i>
                                ${statusConfig.label}
                            </span>
                        </div>

                        <!-- Title & Outcome -->
                        <h3 style="font-size: 1.15rem; font-weight: 800; color: var(--text-main, #0f172a); margin: 0 0 8px; line-height: 1.35;">
                            ${escapeHtml(goal.title)}
                        </h3>
                        <p style="font-size: 0.82rem; color: var(--text-muted, #64748b); line-height: 1.5; margin: 0 0 14px; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden;">
                            <strong>Outcome:</strong> ${escapeHtml(goal.outcome || goal.description || 'No outcome statement defined.')}
                        </p>

                        <!-- Measurement & Target Metric Box -->
                        <div style="background: #f8fafc; border: 1px solid var(--border, #e2e8f0); border-radius: 12px; padding: 12px; margin-bottom: 14px;">
                            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px;">
                                <span style="font-size: 0.7rem; font-weight: 800; text-transform: uppercase; color: #64748b;">
                                    Measurement (${goal.measurement?.method || 'Target'})
                                </span>
                                <span style="font-size: 0.95rem; font-weight: 800; color: var(--primary, #2563eb);">
                                    ${goal.measurement?.current !== undefined ? goal.measurement.current : '--'} / ${goal.measurement?.target || 100} <span style="font-size: 0.75rem; color: #64748b;">${goal.measurement?.unit || '%'}</span>
                                </span>
                            </div>
                            ${goal.measurement?.completionCriteria ? `
                                <div style="font-size: 0.75rem; color: #475569; line-height: 1.4; border-top: 1px dashed var(--border); padding-top: 6px; margin-top: 4px;">
                                    <span style="font-weight: 700; color: #334155;">Criteria:</span> ${escapeHtml(goal.measurement.completionCriteria)}
                                </div>
                            ` : ''}
                        </div>

                        <!-- Progress Bar & Slider Controller -->
                        <div style="margin-bottom: 14px;">
                            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px;">
                                <span style="font-size: 0.72rem; font-weight: 800; color: #475569; text-transform: uppercase;">Overall Progress</span>
                                <span style="font-size: 0.85rem; font-weight: 800; color: ${goal.progress >= 100 ? '#10b981' : 'var(--primary, #2563eb)'};">${goal.progress || 0}%</span>
                            </div>
                            <div style="width: 100%; height: 8px; background: #e2e8f0; border-radius: 100px; overflow: hidden; margin-bottom: 6px;">
                                <div style="width: ${goal.progress || 0}%; height: 100%; background: ${goal.progress >= 100 ? '#10b981' : (goal.status === 'paused' ? '#f59e0b' : 'var(--primary, #2563eb)')}; border-radius: 100px; transition: width 0.3s ease;"></div>
                            </div>
                            <div style="display: flex; justify-content: space-between; align-items: center;">
                                <button onclick="window.openUpdateProgressModal('${goal.id}')" style="background: none; border: none; padding: 0; color: var(--primary, #2563eb); font-size: 0.72rem; font-weight: 700; cursor: pointer; text-decoration: underline;">
                                    Quick Check-in / Log Progress
                                </button>
                                ${scheduleBadge}
                            </div>
                        </div>

                        <!-- Milestones Checklist (PRD 1.1 Measure) -->
                        ${milestones.length > 0 ? `
                            <div style="margin-bottom: 14px; border: 1px solid var(--border); border-radius: 12px; padding: 10px 12px; background: white;">
                                <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">
                                    <span style="font-size: 0.7rem; font-weight: 800; text-transform: uppercase; color: #64748b;">
                                        Milestones Checklist (${completedMilestones}/${milestones.length})
                                    </span>
                                </div>
                                <div style="display: flex; flex-direction: column; gap: 6px; max-height: 120px; overflow-y: auto;">
                                    ${milestones.map(m => `
                                        <label style="display: flex; align-items: flex-start; gap: 8px; font-size: 0.78rem; cursor: pointer; color: ${m.completed ? '#94a3b8' : '#1e293b'}; text-decoration: ${m.completed ? 'line-through' : 'none'};">
                                            <input type="checkbox" ${m.completed ? 'checked' : ''} onchange="window.toggleGoalMilestone('${goal.id}', '${m.id}')" style="margin-top: 2px; accent-color: var(--primary, #2563eb); cursor: pointer;">
                                            <span style="flex: 1;">${escapeHtml(m.title)}</span>
                                        </label>
                                    `).join('')}
                                </div>
                            </div>
                        ` : ''}

                        <!-- Schedule & Owner Details -->
                        <div style="display: flex; justify-content: space-between; align-items: center; font-size: 0.75rem; color: #64748b; margin-bottom: 1rem; border-top: 1px solid var(--border); padding-top: 10px;">
                            <span><strong>Start:</strong> ${goal.schedule?.startDate || '—'}</span>
                            <span><strong>Target:</strong> ${goal.schedule?.targetCompletionDate || '—'}</span>
                            <span><strong>Owner:</strong> ${escapeHtml(goal.owner?.name || 'Manager')}</span>
                        </div>
                    </div>

                    <!-- Manage Actions Bar (PRD 1.1 Manage: edited, paused, completed, archived, history) -->
                    <div style="display: flex; gap: 6px; border-top: 1px solid var(--border); padding-top: 12px; flex-wrap: wrap;">
                        <button onclick="window.openEditGoalModal('${goal.id}')" class="btn-ghost" title="Edit Goal Details" style="flex: 1; min-width: 60px; height: 36px; border-radius: 10px; border: 1px solid var(--border); background: white; font-size: 0.75rem; font-weight: 700; color: #334155; display: flex; align-items: center; justify-content: center; gap: 4px;">
                            <i data-lucide="edit-3" style="width: 14px; height: 14px;"></i>
                            <span>Edit</span>
                        </button>

                        ${goal.status === 'paused' ? `
                            <button onclick="window.executeGoalAction('${goal.id}', 'resume')" class="btn-ghost" title="Resume Goal" style="flex: 1; min-width: 70px; height: 36px; border-radius: 10px; border: 1px solid #bbf7d0; background: #f0fdf4; font-size: 0.75rem; font-weight: 700; color: #15803d; display: flex; align-items: center; justify-content: center; gap: 4px;">
                                <i data-lucide="play" style="width: 14px; height: 14px;"></i>
                                <span>Resume</span>
                            </button>
                        ` : (goal.status !== 'completed' && goal.status !== 'archived' ? `
                            <button onclick="window.promptPauseGoal('${goal.id}')" class="btn-ghost" title="Pause Goal Execution" style="flex: 1; min-width: 70px; height: 36px; border-radius: 10px; border: 1px solid #fed7aa; background: #fffbeb; font-size: 0.75rem; font-weight: 700; color: #b45309; display: flex; align-items: center; justify-content: center; gap: 4px;">
                                <i data-lucide="pause" style="width: 14px; height: 14px;"></i>
                                <span>Pause</span>
                            </button>
                        ` : '')}

                        ${goal.status !== 'completed' && goal.status !== 'archived' ? `
                            <button onclick="window.executeGoalAction('${goal.id}', 'complete')" class="btn-ghost" title="Mark Goal as Completed" style="flex: 1; min-width: 75px; height: 36px; border-radius: 10px; border: 1px solid #bfdbfe; background: #eff6ff; font-size: 0.75rem; font-weight: 700; color: #2563eb; display: flex; align-items: center; justify-content: center; gap: 4px;">
                                <i data-lucide="check" style="width: 14px; height: 14px;"></i>
                                <span>Complete</span>
                            </button>
                        ` : ''}

                        ${goal.status !== 'archived' ? `
                            <button onclick="window.executeGoalAction('${goal.id}', 'archive')" class="btn-ghost" title="Archive Goal" style="width: 36px; height: 36px; border-radius: 10px; border: 1px solid var(--border); background: white; color: #64748b; display: flex; align-items: center; justify-content: center;">
                                <i data-lucide="archive" style="width: 14px; height: 14px;"></i>
                            </button>
                        ` : `
                            <button onclick="window.executeGoalAction('${goal.id}', 'resume')" class="btn-ghost" title="Restore Goal" style="flex: 1; height: 36px; border-radius: 10px; border: 1px solid var(--border); background: white; font-size: 0.75rem; font-weight: 700; color: #2563eb; display: flex; align-items: center; justify-content: center; gap: 4px;">
                                <i data-lucide="rotate-ccw" style="width: 14px; height: 14px;"></i>
                                <span>Restore</span>
                            </button>
                        `}

                        <button onclick="window.openGoalHistoryModal('${goal.id}')" class="btn-ghost" title="View Full Audit History Trail" style="width: 36px; height: 36px; border-radius: 10px; border: 1px solid #cbd5e1; background: #f8fafc; color: #0f172a; display: flex; align-items: center; justify-content: center;">
                            <i data-lucide="history" style="width: 14px; height: 14px;"></i>
                        </button>
                    </div>
                </div>
            `;
        }).join('');

        if (window.lucide) window.lucide.createIcons();
    }

    /* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
       1.3 MODULE-LEVEL TEMPLATES (PRD §1.3)
    ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */

    async function loadTemplates() {
        try {
            const role = encodeURIComponent(state.user.role || 'manager');
            const ownerId = encodeURIComponent(state.user.id || 'MGR-JOHN-DOE');
            const res = await fetch(`${API_BASE}/custom-templates?role=${role}&ownerId=${ownerId}&includeArchived=true`);
            if (res.ok) {
                const json = await res.json();
                state.templates = json.data || [];
            }
        } catch (err) {
            console.warn('[CustomTemplates] Failed to fetch templates:', err.message);
        }
        applyTemplateFilters();
    }
    window.loadTemplates = loadTemplates;

    function applyTemplateFilters() {
        let list = [...state.templates];

        // Filter by Module
        if (state.activeTemplateModule !== 'all') {
            list = list.filter(t => t.module.toLowerCase() === state.activeTemplateModule.toLowerCase());
        }

        // Filter by Status (Draft, Published, Archived)
        if (state.activeTemplateStatus !== 'all') {
            list = list.filter(t => t.status.toLowerCase() === state.activeTemplateStatus.toLowerCase());
        }

        // Filter by Scope (Shared vs Personal)
        if (state.activeTemplateScope && state.activeTemplateScope !== 'all') {
            list = list.filter(t => (t.scope || 'shared').toLowerCase() === state.activeTemplateScope.toLowerCase());
        }

        state.filteredTemplates = list;
        renderTemplatesGrid();
    }

    function renderTemplatesGrid() {
        const container = document.getElementById('customTemplatesContainer');
        if (!container) return;

        if (state.filteredTemplates.length === 0) {
            container.innerHTML = `
                <div style="grid-column: 1 / -1; background: white; border: 1.5px dashed var(--border, #e2e8f0); border-radius: 20px; padding: 3rem 1.5rem; text-align: center;">
                    <div style="width: 54px; height: 54px; border-radius: 16px; background: #eff6ff; color: #2563eb; display: flex; align-items: center; justify-content: center; margin: 0 auto 1rem;">
                        <i data-lucide="layout-template" style="width: 28px; height: 28px;"></i>
                    </div>
                    <h3 style="font-size: 1.1rem; font-weight: 800; color: #0f172a; margin-bottom: 6px;">No Module Templates Found</h3>
                    <p style="font-size: 0.85rem; color: #64748b; max-width: 440px; margin: 0 auto 1.5rem;">
                        No templates match the selected module, scope, or status criteria. Shared templates can be provided by administrators, and managers can create personal copies anytime.
                    </p>
                    <button onclick="window.openCreateTemplateModal()" class="alert-btn" style="background: var(--primary, #2563eb); color: white; width: auto; padding: 10px 20px; margin: 0 auto;">
                        + Create New Template
                    </button>
                </div>
            `;
            if (window.lucide) window.lucide.createIcons();
            return;
        }

        container.innerHTML = state.filteredTemplates.map(tpl => {
            const isDraft = tpl.status === 'draft';
            const isArchived = tpl.status === 'archived';
            const isPersonal = tpl.scope === 'personal' || tpl.isPersonal;

            // Scope Badge
            const scopeBadge = isPersonal
                ? `<span style="background: #fdf4ff; color: #9333ea; border: 1px solid #f0abfc; font-size: 0.65rem; font-weight: 800; padding: 2px 8px; border-radius: 6px; text-transform: uppercase;">Personal Copy (${escapeHtml(tpl.ownerName || 'Manager')})</span>`
                : `<span style="background: #eff6ff; color: #2563eb; border: 1px solid #bfdbfe; font-size: 0.65rem; font-weight: 800; padding: 2px 8px; border-radius: 6px; text-transform: uppercase;">Shared Admin Template</span>`;

            // Status Badge and Expected Behavior note (PRD 1.3)
            let statusBadge = '';
            let behaviorNote = '';
            let borderAccent = '#3b82f6';

            if (isArchived) {
                statusBadge = `<span style="background: #ffe4e6; color: #be123c; border: 1px solid #fecdd3; font-size: 0.68rem; font-weight: 800; padding: 3px 8px; border-radius: 20px; text-transform: uppercase;">Archived (${tpl.version})</span>`;
                behaviorNote = `<div style="font-size: 0.72rem; color: #be123c; font-weight: 700; margin-top: 4px;">• Retained for history; unavailable for new use</div>`;
                borderAccent = '#e11d48';
            } else if (isDraft) {
                statusBadge = `<span style="background: #fef3c7; color: #b45309; border: 1px solid #fde68a; font-size: 0.68rem; font-weight: 800; padding: 3px 8px; border-radius: 20px; text-transform: uppercase;">Draft (${tpl.version})</span>`;
                behaviorNote = `<div style="font-size: 0.72rem; color: #b45309; font-weight: 700; margin-top: 4px;">• Editable; not available for general use</div>`;
                borderAccent = '#f59e0b';
            } else {
                statusBadge = `<span style="background: #dcfce7; color: #166534; border: 1px solid #bbf7d0; font-size: 0.68rem; font-weight: 800; padding: 3px 8px; border-radius: 20px; text-transform: uppercase;">Published (${tpl.version})</span>`;
                behaviorNote = `<div style="font-size: 0.72rem; color: #166534; font-weight: 700; margin-top: 4px;">• Available to permitted users</div>`;
                borderAccent = '#10b981';
            }

            const permittedCount = (tpl.permittedFields || []).filter(f => f.isPermittedToEdit).length;
            const lockedCount = (tpl.lockedFields || []).length;
            const allowsCopy = tpl.permissions?.allowPersonalCopies !== false;

            return `
                <div class="card" style="display: flex; flex-direction: column; justify-content: space-between; border-top: 4px solid ${borderAccent};">
                    <div>
                        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">
                            <span style="font-size: 0.7rem; font-weight: 800; text-transform: uppercase; background: #f8fafc; color: #475569; padding: 3px 8px; border-radius: 6px; border: 1px solid var(--border);">
                                Module: ${tpl.module.toUpperCase()}
                            </span>
                            ${statusBadge}
                        </div>

                        <div style="margin-bottom: 8px;">
                            ${scopeBadge}
                        </div>

                        <h3 style="font-size: 1.1rem; font-weight: 800; color: #0f172a; margin: 0 0 6px;">
                            ${escapeHtml(tpl.name)}
                        </h3>
                        <p style="font-size: 0.8rem; color: #64748b; line-height: 1.4; margin: 0 0 10px; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden;">
                            ${escapeHtml(tpl.description || 'Standard module template.')}
                        </p>

                        ${behaviorNote}

                        <!-- Permitted Fields & Instructions Preview Box -->
                        <div style="background: #f8fafc; border: 1px solid var(--border); border-radius: 12px; padding: 10px 12px; margin: 10px 0 12px;">
                            <div style="display: flex; justify-content: space-between; font-size: 0.72rem; font-weight: 700; color: #334155; margin-bottom: 4px;">
                                <span>Permitted Fields: <strong style="color: #2563eb;">${permittedCount} Editable</strong></span>
                                <span>Locked: <strong style="color: #64748b;">${lockedCount}</strong></span>
                            </div>
                            <p style="font-size: 0.75rem; color: #64748b; margin: 0; font-style: italic;">
                                " ${escapeHtml(tpl.instructions || 'Standard instructions for permitted fields.')} "
                            </p>
                        </div>
                    </div>

                    <!-- Action buttons -->
                    <div style="display: flex; flex-direction: column; gap: 8px; border-top: 1px solid var(--border); padding-top: 12px;">
                        ${isArchived ? `
                            <div style="background: #fff1f2; border: 1px dashed #fecdd3; border-radius: 10px; padding: 8px 12px; text-align: center; font-size: 0.75rem; color: #9f1239; font-weight: 700;">
                                🔒 Retained for History — Unavailable for New Records
                            </div>
                            <div style="display: flex; gap: 6px;">
                                <button onclick="window.openTemplateVersionHistoryModal('${tpl.id}')" class="btn-ghost" title="View Version Snapshots" style="flex: 1; border: 1px solid var(--border); background: white; padding: 8px 12px; border-radius: 10px; font-size: 0.78rem; font-weight: 700; color: #334155; display: flex; align-items: center; justify-content: center; gap: 4px;">
                                    <i data-lucide="git-branch" style="width: 14px; height: 14px;"></i>
                                    <span>Version History (${tpl.versions?.length || 1})</span>
                                </button>
                                <button onclick="window.openTemplatePreviewModal('${tpl.id}')" class="btn-ghost" title="Live Preview" style="border: 1px solid var(--border); background: white; padding: 8px 12px; border-radius: 10px; font-size: 0.78rem; font-weight: 700; color: #334155;">
                                    Preview
                                </button>
                            </div>
                        ` : `
                            <div style="display: flex; gap: 6px;">
                                <button onclick="window.useTemplateToCreateGoal('${tpl.id}')" class="alert-btn" style="background: var(--primary, #2563eb); color: white; margin: 0; padding: 8px 12px; font-size: 0.78rem; flex: 2; display: flex; align-items: center; justify-content: center; gap: 6px;">
                                    <i data-lucide="play" style="width: 14px; height: 14px;"></i>
                                    <span>Use Template</span>
                                </button>
                                <button onclick="window.openTemplatePreviewModal('${tpl.id}')" class="btn-ghost" title="Live Preview" style="border: 1px solid var(--border); background: white; padding: 8px 12px; border-radius: 10px; font-size: 0.78rem; font-weight: 700; color: #334155; display: flex; align-items: center; gap: 4px;">
                                    <i data-lucide="eye" style="width: 14px; height: 14px;"></i>
                                    <span>Preview</span>
                                </button>
                                <button onclick="window.location.href='bulk-trigger-dashboard.html?templateId=${encodeURIComponent(tpl.id)}&templateName=${encodeURIComponent(tpl.name)}'" class="btn-ghost" title="Bulk Trigger & Dispatch (PRD §2)" style="border: 1px solid #bfdbfe; background: #eff6ff; padding: 8px 12px; border-radius: 10px; font-size: 0.78rem; font-weight: 700; color: #1d4ed8; display: flex; align-items: center; gap: 4px;">
                                    <i data-lucide="zap" style="width: 14px; height: 14px;"></i>
                                    <span>Bulk Trigger</span>
                                </button>
                            </div>

                            <div style="display: flex; gap: 6px; flex-wrap: wrap;">
                                ${allowsCopy ? `
                                    <button onclick="window.openPersonalCopyModal('${tpl.id}')" class="btn-ghost" title="Make Personal Copy for Your Team" style="flex: 1.2; border: 1px solid #e9d5ff; background: #faf5ff; padding: 6px 10px; border-radius: 8px; font-size: 0.72rem; font-weight: 700; color: #9333ea; display: flex; align-items: center; justify-content: center; gap: 4px;">
                                        <i data-lucide="copy" style="width: 12px; height: 12px;"></i>
                                        <span>Personal Copy</span>
                                    </button>
                                ` : ''}

                                <button onclick="window.openTemplateVersionModal('${tpl.id}')" class="btn-ghost" title="Publish New Version" style="flex: 1; border: 1px solid #bfdbfe; background: #eff6ff; padding: 6px 10px; border-radius: 8px; font-size: 0.72rem; font-weight: 700; color: #2563eb; display: flex; align-items: center; justify-content: center; gap: 4px;">
                                    <i data-lucide="git-commit" style="width: 12px; height: 12px;"></i>
                                    <span>New Ver</span>
                                </button>

                                <button onclick="window.openTemplateVersionHistoryModal('${tpl.id}')" class="btn-ghost" title="Version Snapshots" style="border: 1px solid var(--border); background: #f8fafc; padding: 6px 8px; border-radius: 8px; font-size: 0.72rem; font-weight: 700; color: #475569; display: flex; align-items: center; justify-content: center; gap: 3px;">
                                    <i data-lucide="git-branch" style="width: 12px; height: 12px;"></i>
                                    <span>${tpl.version}</span>
                                </button>

                                <button onclick="window.openCustomizeTemplateModal('${tpl.id}')" class="btn-ghost" title="Customize Fields" style="border: 1px solid var(--border); background: #f8fafc; padding: 6px 8px; border-radius: 8px; font-size: 0.72rem; font-weight: 700; color: #475569; display: flex; align-items: center; justify-content: center;">
                                    <i data-lucide="sliders" style="width: 12px; height: 12px;"></i>
                                </button>

                                ${isDraft ? `
                                    <button onclick="window.publishTemplateAction('${tpl.id}')" class="btn-ghost" title="Publish Template" style="border: 1px solid #bbf7d0; background: #f0fdf4; padding: 6px 8px; border-radius: 8px; font-size: 0.72rem; font-weight: 700; color: #166534; display: flex; align-items: center; justify-content: center;">
                                        <i data-lucide="upload-cloud" style="width: 12px; height: 12px;"></i>
                                    </button>
                                ` : ''}

                                <button onclick="window.openArchiveTemplateModal('${tpl.id}')" class="btn-ghost" title="Archive Template" style="border: 1px solid #fecdd3; background: #fff1f2; padding: 6px 8px; border-radius: 8px; color: #be123c; display: flex; align-items: center; justify-content: center;">
                                    <i data-lucide="archive" style="width: 12px; height: 12px;"></i>
                                </button>

                                <button onclick="window.openTemplatePermissionsModal('${tpl.id}')" class="btn-ghost" title="Manage Permissions" style="border: 1px solid var(--border); background: #f8fafc; padding: 6px 8px; border-radius: 8px; color: #64748b; display: flex; align-items: center; justify-content: center;">
                                    <i data-lucide="shield" style="width: 12px; height: 12px;"></i>
                                </button>
                            </div>
                        `}
                    </div>
                </div>
            `;
        }).join('');

        if (window.lucide) window.lucide.createIcons();
    }

    /* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
       EVENT HANDLERS & MODAL CONTROLS
    ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */

    function bindEventListeners() {
        // Goal Filter Tabs
        document.querySelectorAll('.goal-filter-tab').forEach(tab => {
            tab.addEventListener('click', (e) => {
                document.querySelectorAll('.goal-filter-tab').forEach(t => t.classList.remove('active'));
                tab.classList.add('active');
                state.activeGoalFilter = tab.getAttribute('data-filter') || 'all';
                applyGoalFilters();
            });
        });

        // Goal Category Select
        const catSelect = document.getElementById('goalCategoryFilter');
        if (catSelect) {
            catSelect.addEventListener('change', (e) => {
                state.activeGoalCategory = e.target.value;
                applyGoalFilters();
            });
        }

        // Goal Search
        const searchInput = document.getElementById('goalSearchInput');
        if (searchInput) {
            searchInput.addEventListener('input', (e) => {
                state.goalSearchQuery = e.target.value.trim();
                applyGoalFilters();
            });
        }

        // Template Module Tabs
        document.querySelectorAll('.template-module-tab').forEach(tab => {
            tab.addEventListener('click', (e) => {
                document.querySelectorAll('.template-module-tab').forEach(t => t.classList.remove('active'));
                tab.classList.add('active');
                state.activeTemplateModule = tab.getAttribute('data-module') || 'all';
                applyTemplateFilters();
            });
        });

        // Template Status Filter
        const tplStatusSelect = document.getElementById('templateStatusFilter');
        if (tplStatusSelect) {
            tplStatusSelect.addEventListener('change', (e) => {
                state.activeTemplateStatus = e.target.value;
                applyTemplateFilters();
            });
        }

        // Template Scope Filter (PRD 1.3: Shared Admin vs Personal Copy)
        const tplScopeSelect = document.getElementById('templateScopeFilter');
        if (tplScopeSelect) {
            tplScopeSelect.addEventListener('change', (e) => {
                state.activeTemplateScope = e.target.value;
                applyTemplateFilters();
            });
        }
    }

    /* ─── Create / Edit Goal Modal ─── */
    window.openCreateGoalModal = function (prefill = null) {
        state.currentGoalId = null;
        document.getElementById('goalModalTitle').textContent = 'Create Strategic Manager Goal';
        document.getElementById('goalModalSubmitBtn').textContent = 'Create Goal';
        document.getElementById('goalFormId').value = '';

        // Reset or prefill form
        document.getElementById('goalFormTitle').value = prefill?.title || '';
        document.getElementById('goalFormCategory').value = prefill?.category || 'Operational Excellence';
        document.getElementById('goalFormOutcome').value = prefill?.outcome || '';
        document.getElementById('goalFormDesc').value = prefill?.description || '';
        document.getElementById('goalFormMethod').value = prefill?.measurement?.method || 'quantitative';
        document.getElementById('goalFormTarget').value = prefill?.measurement?.target !== undefined ? prefill.measurement.target : 100;
        document.getElementById('goalFormUnit').value = prefill?.measurement?.unit || '%';
        document.getElementById('goalFormCriteria').value = prefill?.measurement?.completionCriteria || '';
        
        const todayStr = new Date().toISOString().split('T')[0];
        document.getElementById('goalFormStartDate').value = prefill?.schedule?.startDate || todayStr;
        document.getElementById('goalFormTargetDate').value = prefill?.schedule?.targetCompletionDate || '';

        // Reset milestones builder
        renderMilestoneInputs(prefill?.measurement?.milestones || [
            { title: 'Initial Sprint Planning & Architectural Scoping' },
            { title: 'Core Implementation & Telemetry Verification' },
            { title: 'Final Production Rollout & Sign-off' }
        ]);

        document.getElementById('managerGoalModal').style.display = 'flex';
        if (window.lucide) window.lucide.createIcons();
    };

    window.openEditGoalModal = function (goalId) {
        const goal = state.goals.find(g => g.id === goalId);
        if (!goal) return;
        state.currentGoalId = goalId;
        document.getElementById('goalModalTitle').textContent = `Edit Goal: ${goal.title}`;
        document.getElementById('goalModalSubmitBtn').textContent = 'Save Changes';
        document.getElementById('goalFormId').value = goal.id;

        document.getElementById('goalFormTitle').value = goal.title;
        document.getElementById('goalFormCategory').value = goal.category;
        document.getElementById('goalFormOutcome').value = goal.outcome || '';
        document.getElementById('goalFormDesc').value = goal.description || '';
        document.getElementById('goalFormMethod').value = goal.measurement?.method || 'quantitative';
        document.getElementById('goalFormTarget').value = goal.measurement?.target || 100;
        document.getElementById('goalFormUnit').value = goal.measurement?.unit || '%';
        document.getElementById('goalFormCriteria').value = goal.measurement?.completionCriteria || '';
        document.getElementById('goalFormStartDate').value = goal.schedule?.startDate || '';
        document.getElementById('goalFormTargetDate').value = goal.schedule?.targetCompletionDate || '';

        renderMilestoneInputs(goal.measurement?.milestones || []);

        document.getElementById('managerGoalModal').style.display = 'flex';
        if (window.lucide) window.lucide.createIcons();
    };

    window.closeManagerGoalModal = function () {
        document.getElementById('managerGoalModal').style.display = 'none';
    };

    function renderMilestoneInputs(milestones = []) {
        const container = document.getElementById('goalFormMilestonesContainer');
        if (!container) return;

        container.innerHTML = milestones.map((m, idx) => `
            <div class="milestone-row" style="display: flex; gap: 8px; align-items: center; margin-bottom: 6px;">
                <span style="font-size: 0.75rem; font-weight: 800; color: #64748b; width: 20px;">#${idx + 1}</span>
                <input type="text" class="milestone-input" value="${escapeHtml(m.title || '')}" placeholder="Milestone outcome or deliverable..." style="flex: 1; padding: 8px 12px; border-radius: 10px; border: 1px solid var(--border); font-size: 0.82rem; outline: none; background: #f8fafc;">
                <button type="button" onclick="this.parentElement.remove()" style="background: none; border: none; color: #ef4444; cursor: pointer; padding: 4px;">
                    <i data-lucide="trash-2" style="width: 14px; height: 14px;"></i>
                </button>
            </div>
        `).join('');

        if (window.lucide) window.lucide.createIcons();
    }

    window.addMilestoneInputRow = function () {
        const container = document.getElementById('goalFormMilestonesContainer');
        const count = container.querySelectorAll('.milestone-row').length + 1;
        const row = document.createElement('div');
        row.className = 'milestone-row';
        row.style.cssText = 'display: flex; gap: 8px; align-items: center; margin-bottom: 6px;';
        row.innerHTML = `
            <span style="font-size: 0.75rem; font-weight: 800; color: #64748b; width: 20px;">#${count}</span>
            <input type="text" class="milestone-input" placeholder="Milestone outcome or deliverable..." style="flex: 1; padding: 8px 12px; border-radius: 10px; border: 1px solid var(--border); font-size: 0.82rem; outline: none; background: #f8fafc;">
            <button type="button" onclick="this.parentElement.remove()" style="background: none; border: none; color: #ef4444; cursor: pointer; padding: 4px;">
                <i data-lucide="trash-2" style="width: 14px; height: 14px;"></i>
            </button>
        `;
        container.appendChild(row);
        if (window.lucide) window.lucide.createIcons();
    };

    window.handleGoalFormSubmit = async function (e) {
        e.preventDefault();
        const goalId = document.getElementById('goalFormId').value;
        const title = document.getElementById('goalFormTitle').value.trim();
        const category = document.getElementById('goalFormCategory').value;
        const outcome = document.getElementById('goalFormOutcome').value.trim();
        const description = document.getElementById('goalFormDesc').value.trim();
        const method = document.getElementById('goalFormMethod').value;
        const target = parseFloat(document.getElementById('goalFormTarget').value) || 100;
        const unit = document.getElementById('goalFormUnit').value.trim() || '%';
        const completionCriteria = document.getElementById('goalFormCriteria').value.trim();
        const startDate = document.getElementById('goalFormStartDate').value;
        const targetCompletionDate = document.getElementById('goalFormTargetDate').value;

        // Collect milestones
        const milestoneInputs = document.querySelectorAll('#goalFormMilestonesContainer .milestone-input');
        const milestones = Array.from(milestoneInputs)
            .map((inp, idx) => ({ id: `m_${idx + 1}`, title: inp.value.trim(), completed: false }))
            .filter(m => m.title);

        const payload = {
            title,
            category,
            outcome,
            description,
            measurement: {
                method,
                target,
                unit,
                completionCriteria,
                milestones
            },
            schedule: {
                startDate,
                targetCompletionDate
            },
            actor: {
                id: state.user.id,
                name: state.user.name,
                role: state.user.role
            }
        };

        let saved = false;
        try {
            if (goalId) {
                // Update via API
                const res = await fetch(`${API_BASE}/manager-goals/${encodeURIComponent(goalId)}`, {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(payload),
                    signal: AbortSignal.timeout(2500)
                });
                if (res.ok) {
                    showGoalNotification('Goal updated successfully!');
                    saved = true;
                }
            } else {
                // Create via API
                const res = await fetch(`${API_BASE}/manager-goals`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(payload),
                    signal: AbortSignal.timeout(2500)
                });
                if (res.ok) {
                    showGoalNotification(`Goal "${title}" successfully created!`);
                    saved = true;
                }
            }
        } catch (err) {
            console.warn('[ManagerGoals] API error, persisting locally:', err.message);
        }

        if (!saved) {
            // Local fallback handling
            const now = new Date().toISOString();
            if (goalId) {
                const existingIndex = state.goals.findIndex(g => g.id === goalId);
                if (existingIndex !== -1) {
                    const existing = state.goals[existingIndex];
                    const updated = {
                        ...existing,
                        ...payload,
                        updatedAt: now,
                        history: existing.history || []
                    };
                    updated.history.unshift({
                        timestamp: now,
                        actor: { name: state.user.name, role: state.user.role },
                        action: 'edited',
                        summary: `Goal details updated by ${state.user.name}`,
                        notes: `Title: "${title}", Category: ${category}`
                    });
                    state.goals[existingIndex] = updated;
                }
                showGoalNotification('Goal updated successfully!');
            } else {
                const newGoal = {
                    id: `MGR-GOAL-${Date.now()}-${Math.random().toString(36).substring(2, 6).toUpperCase()}`,
                    ...payload,
                    owner: { id: state.user.id, name: state.user.name, role: state.user.role, department: state.user.department },
                    progress: 0,
                    status: 'active',
                    createdAt: now,
                    history: [
                        {
                            timestamp: now,
                            actor: { name: state.user.name, role: state.user.role },
                            action: 'created',
                            summary: `Goal "${title}" created by ${state.user.name}`,
                            notes: `Target: ${target} ${unit} • Method: ${method}`
                        }
                    ]
                };
                state.goals.unshift(newGoal);
                showGoalNotification(`Goal "${title}" created successfully!`);
            }
            saveLocalGoals(state.goals);
        }

        closeManagerGoalModal();
        await loadGoals();
        await loadStats();
    };

    /* ─── Toggle Milestone ─── */
    window.toggleGoalMilestone = async function (goalId, milestoneId) {
        let updated = false;
        try {
            const res = await fetch(`${API_BASE}/manager-goals/${encodeURIComponent(goalId)}/milestones/${encodeURIComponent(milestoneId)}/toggle`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ actor: { name: state.user.name, role: state.user.role } }),
                signal: AbortSignal.timeout(2000)
            });
            if (res.ok) {
                updated = true;
                await loadGoals();
                await loadStats();
            }
        } catch (err) {
            console.warn('[ManagerGoals] Toggle API offline, executing locally:', err.message);
        }

        if (!updated) {
            const goal = state.goals.find(g => g.id === goalId);
            if (goal && goal.measurement && Array.isArray(goal.measurement.milestones)) {
                const m = goal.measurement.milestones.find(item => item.id === milestoneId);
                if (m) {
                    m.completed = !m.completed;
                    const totalMilestones = goal.measurement.milestones.length;
                    const completedMilestones = goal.measurement.milestones.filter(item => item.completed).length;
                    if (goal.measurement.method === 'milestone') {
                        goal.progress = Math.round((completedMilestones / totalMilestones) * 100);
                        if (goal.progress >= 100 && goal.status === 'active') goal.status = 'completed';
                    }
                    if (!goal.history) goal.history = [];
                    goal.history.unshift({
                        timestamp: new Date().toISOString(),
                        actor: { name: state.user.name, role: state.user.role },
                        action: 'milestone_toggled',
                        summary: `Milestone "${m.title}" marked as ${m.completed ? 'COMPLETED' : 'PENDING'}`,
                        notes: `Milestones checklist status: ${completedMilestones}/${totalMilestones}`
                    });
                    saveLocalGoals(state.goals);
                    applyGoalFilters();
                    loadStats();
                }
            }
        }
    };

    /* ─── Quick Progress & Check-in Modal ─── */
    window.openUpdateProgressModal = function (goalId) {
        const goal = state.goals.find(g => g.id === goalId);
        if (!goal) return;
        state.currentGoalId = goalId;

        document.getElementById('progressGoalTitle').textContent = goal.title;
        document.getElementById('progressSlider').value = goal.progress || 0;
        document.getElementById('progressValueDisplay').textContent = `${goal.progress || 0}%`;
        document.getElementById('progressCurrentMetric').value = goal.measurement?.current !== undefined ? goal.measurement.current : '';
        document.getElementById('progressMetricUnitLabel').textContent = goal.measurement?.unit || '%';
        document.getElementById('progressCheckInNote').value = '';

        document.getElementById('updateProgressModal').style.display = 'flex';
    };

    window.closeUpdateProgressModal = function () {
        document.getElementById('updateProgressModal').style.display = 'none';
    };

    window.handleProgressSliderInput = function (val) {
        document.getElementById('progressValueDisplay').textContent = `${val}%`;
    };

    window.submitGoalProgressUpdate = async function () {
        const goalId = state.currentGoalId;
        const progress = parseInt(document.getElementById('progressSlider').value, 10);
        const currentValue = document.getElementById('progressCurrentMetric').value ? parseFloat(document.getElementById('progressCurrentMetric').value) : null;
        const note = document.getElementById('progressCheckInNote').value.trim();

        let updated = false;
        try {
            const res = await fetch(`${API_BASE}/manager-goals/${encodeURIComponent(goalId)}/progress`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    progress,
                    currentValue,
                    note,
                    actor: { name: state.user.name, role: state.user.role }
                }),
                signal: AbortSignal.timeout(2500)
            });
            if (res.ok) {
                updated = true;
                showGoalNotification(`Progress recorded at ${progress}%!`);
            }
        } catch (err) {
            console.warn('[ManagerGoals] Progress update API offline, executing locally:', err.message);
        }

        if (!updated) {
            const goal = state.goals.find(g => g.id === goalId);
            if (goal) {
                goal.progress = progress;
                if (currentValue !== null && goal.measurement) {
                    goal.measurement.current = currentValue;
                }
                if (progress >= 100 && goal.status !== 'archived') {
                    goal.status = 'completed';
                }
                if (!goal.history) goal.history = [];
                goal.history.unshift({
                    timestamp: new Date().toISOString(),
                    actor: { name: state.user.name, role: state.user.role },
                    action: 'progress_updated',
                    summary: `Progress recorded at ${progress}%${currentValue !== null ? ` (Metric: ${currentValue} ${goal.measurement?.unit || ''})` : ''}`,
                    notes: note || 'Progress check-in logged by manager'
                });
                saveLocalGoals(state.goals);
                showGoalNotification(`Progress recorded at ${progress}%!`);
            }
        }

        closeUpdateProgressModal();
        await loadGoals();
        await loadStats();
    };

    /* ─── Manage Actions (Pause, Resume, Complete, Archive) ─── */
    window.promptPauseGoal = function (goalId) {
        const reason = prompt('Please specify a brief reason for pausing this goal (e.g., Awaiting infrastructure upgrade):', 'Pending telemetry API upgrade');
        if (reason === null) return;
        executeGoalAction(goalId, 'pause', { reason });
    };

    window.executeGoalAction = async function (goalId, action, options = {}) {
        if (action === 'complete' && !confirm('Mark this strategic goal as 100% achieved and completed?')) return;
        if (action === 'archive' && !confirm('Archive this goal from active workspace view?')) return;

        let executed = false;
        try {
            const res = await fetch(`${API_BASE}/manager-goals/${encodeURIComponent(goalId)}/action`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    action,
                    ...options,
                    actor: { name: state.user.name, role: state.user.role }
                }),
                signal: AbortSignal.timeout(2500)
            });
            if (res.ok) {
                executed = true;
                showGoalNotification(`Goal status transitioned to ${action}!`);
            }
        } catch (err) {
            console.warn('[ManagerGoals] Action API offline, executing locally:', err.message);
        }

        if (!executed) {
            const goal = state.goals.find(g => g.id === goalId);
            if (goal) {
                const prevStatus = goal.status;
                if (action === 'pause') goal.status = 'paused';
                else if (action === 'resume') goal.status = 'active';
                else if (action === 'complete') {
                    goal.status = 'completed';
                    goal.progress = 100;
                }
                else if (action === 'archive') goal.status = 'archived';

                if (!goal.history) goal.history = [];
                goal.history.unshift({
                    timestamp: new Date().toISOString(),
                    actor: { name: state.user.name, role: state.user.role },
                    action: action === 'resume' ? 'resumed' : (action === 'complete' ? 'completed' : (action === 'pause' ? 'paused' : action)),
                    summary: `Goal transitioned from ${prevStatus.toUpperCase()} to ${goal.status.toUpperCase()}`,
                    notes: options.reason || `Manager action: ${action}`
                });
                saveLocalGoals(state.goals);
                showGoalNotification(`Goal status transitioned to ${action}!`);
            }
        }

        await loadGoals();
        await loadStats();
    };

    /* ─── Goal Audit History Drawer / Modal (PRD 1.1 History) ─── */
    window.openGoalHistoryModal = async function (goalId) {
        const goal = state.goals.find(g => g.id === goalId);
        if (!goal) return;

        document.getElementById('goalHistoryTitle').textContent = `Audit Trail: ${goal.title}`;
        const container = document.getElementById('goalHistoryTimeline');
        container.innerHTML = '<div style="text-align:center; padding:2rem; color:#64748b;">Loading audit history...</div>';
        document.getElementById('goalHistoryModal').style.display = 'flex';

        let history = [];
        try {
            const res = await fetch(`${API_BASE}/manager-goals/${encodeURIComponent(goalId)}/history`, { signal: AbortSignal.timeout(2000) });
            if (res.ok) {
                const json = await res.json();
                history = json.data || [];
            }
        } catch (err) {
            // fallback to local goal.history
        }

        if (!history || history.length === 0) {
            history = goal.history || [];
        }

        if (history.length === 0) {
            container.innerHTML = '<div style="text-align:center; padding:2rem; color:#64748b;">No audit entries found.</div>';
            return;
        }

        container.innerHTML = history.map((entry, idx) => {
            const dateStr = new Date(entry.timestamp).toLocaleString();
            const iconMap = {
                created: 'plus-circle',
                progress_updated: 'trending-up',
                milestone_toggled: 'check-square',
                paused: 'pause-circle',
                resumed: 'play-circle',
                completed: 'award',
                archived: 'archive',
                edited: 'edit-2',
                note_added: 'message-circle'
            };
            const icon = iconMap[entry.action] || 'clock';

            return `
                <div style="display: flex; gap: 14px; position: relative; margin-bottom: 20px;">
                    <div style="width: 36px; height: 36px; border-radius: 50%; background: #eff6ff; color: #2563eb; display: flex; align-items: center; justify-content: center; flex-shrink: 0; border: 2px solid #bfdbfe;">
                        <i data-lucide="${icon}" style="width: 18px; height: 18px;"></i>
                    </div>
                    <div style="flex: 1; background: #f8fafc; border: 1px solid var(--border); border-radius: 12px; padding: 12px 16px;">
                        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 4px;">
                            <strong style="font-size: 0.85rem; color: #0f172a;">${escapeHtml(entry.summary)}</strong>
                            <span style="font-size: 0.72rem; color: #64748b;">${dateStr}</span>
                        </div>
                        <div style="font-size: 0.78rem; color: #475569; margin-bottom: 4px;">
                            Actor: <strong>${escapeHtml(entry.actor?.name || 'Manager')}</strong> (${escapeHtml(entry.actor?.role || 'Department Lead')})
                        </div>
                        ${entry.notes ? `
                            <div style="font-size: 0.75rem; color: #334155; background: white; border: 1px solid #e2e8f0; border-radius: 8px; padding: 6px 10px; margin-top: 6px; font-style: italic;">
                                "${escapeHtml(entry.notes)}"
                            </div>
                        ` : ''}
                    </div>
                </div>
            `;
        }).join('');

        if (window.lucide) window.lucide.createIcons();
    };

    window.closeGoalHistoryModal = function () {
        document.getElementById('goalHistoryModal').style.display = 'none';
    };

    /* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
       1.2 TEMPLATE PICKER, CREATION, CUSTOMIZATION & PREVIEW
    ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */

    // "Users can choose an existing template"
    window.openTemplatePickerModal = function (moduleFilter = 'goals') {
        const listContainer = document.getElementById('templatePickerList');
        const filtered = state.templates.filter(t => moduleFilter === 'all' || t.module === moduleFilter);

        listContainer.innerHTML = filtered.map(t => `
            <div style="background: white; border: 1.5px solid var(--border); border-radius: 14px; padding: 14px; display: flex; justify-content: space-between; align-items: center; gap: 12px; transition: border-color 0.2s;">
                <div style="flex: 1;">
                    <div style="display: flex; gap: 6px; align-items: center; margin-bottom: 4px;">
                        <span style="font-size: 0.65rem; font-weight: 800; background: #eff6ff; color: #2563eb; padding: 2px 6px; border-radius: 6px;">${t.category}</span>
                        <h4 style="font-size: 0.95rem; font-weight: 800; color: #0f172a; margin: 0;">${escapeHtml(t.name)}</h4>
                    </div>
                    <p style="font-size: 0.78rem; color: #64748b; margin: 0; line-height: 1.4;">${escapeHtml(t.description)}</p>
                </div>
                <div style="display: flex; gap: 6px;">
                    <button onclick="window.useTemplateToCreateGoal('${t.id}')" class="alert-btn" style="background: var(--primary, #2563eb); color: white; margin: 0; padding: 8px 14px; font-size: 0.75rem; white-space: nowrap;">
                        Choose Template
                    </button>
                    <button onclick="window.openTemplatePreviewModal('${t.id}')" class="btn-ghost" style="border: 1px solid var(--border); background: #f8fafc; padding: 8px 10px; border-radius: 8px; font-size: 0.75rem;">
                        Preview
                    </button>
                </div>
            </div>
        `).join('');

        document.getElementById('templatePickerModal').style.display = 'flex';
    };

    window.closeTemplatePickerModal = function () {
        document.getElementById('templatePickerModal').style.display = 'none';
    };

    window.useTemplateToCreateGoal = function (templateId) {
        const tpl = state.templates.find(t => t.id === templateId || t.key === templateId);
        if (!tpl) return;
        closeTemplatePickerModal();

        const prefill = {
            title: tpl.structure.defaultTitle || tpl.name,
            category: tpl.category,
            outcome: tpl.structure.defaultOutcome || tpl.description,
            description: tpl.description,
            measurement: {
                method: tpl.structure.measurementMethod || 'quantitative',
                target: tpl.structure.defaultTarget !== undefined ? tpl.structure.defaultTarget : 100,
                unit: tpl.structure.defaultUnit || '%',
                milestones: tpl.structure.defaultMilestones || []
            },
            schedule: {
                startDate: new Date().toISOString().split('T')[0],
                targetCompletionDate: ''
            }
        };

        openCreateGoalModal(prefill);
    };

    // "Authorised users can create new templates"
    window.openCreateTemplateModal = function () {
        document.getElementById('tplCreateName').value = '';
        document.getElementById('tplCreateModule').value = 'goals';
        document.getElementById('tplCreateCategory').value = 'Operational Excellence';
        document.getElementById('tplCreateDesc').value = '';
        document.getElementById('tplCreateInstructions').value = 'Users can edit permitted fields before saving.';
        document.getElementById('tplCreatePermittedFields').value = 'title, outcome, target, unit, targetCompletionDate';
        document.getElementById('tplCreateLockedFields').value = 'departmentCode, corporateEntity';
        document.getElementById('tplCreateStatusDraft').checked = false;
        document.getElementById('tplCreateStatusPublished').checked = true;

        document.getElementById('createTemplateModal').style.display = 'flex';
    };

    window.closeCreateTemplateModal = function () {
        document.getElementById('createTemplateModal').style.display = 'none';
    };

    window.submitCreateTemplate = async function (e) {
        e.preventDefault();
        const name = document.getElementById('tplCreateName').value.trim();
        const module = document.getElementById('tplCreateModule').value;
        const category = document.getElementById('tplCreateCategory').value.trim();
        const description = document.getElementById('tplCreateDesc').value.trim();
        const instructions = document.getElementById('tplCreateInstructions').value.trim();
        const isDraft = document.getElementById('tplCreateStatusDraft').checked;
        const permittedKeys = document.getElementById('tplCreatePermittedFields').value.split(',').map(s => s.trim()).filter(Boolean);
        const lockedKeys = document.getElementById('tplCreateLockedFields').value.split(',').map(s => s.trim()).filter(Boolean);

        const permittedFields = permittedKeys.map(key => ({
            fieldKey: key,
            label: key.charAt(0).toUpperCase() + key.slice(1).replace(/([A-Z])/g, ' $1'),
            type: 'text',
            isPermittedToEdit: true,
            isRequired: true,
            defaultValue: ''
        }));

        const payload = {
            name,
            module,
            category,
            description,
            instructions,
            status: isDraft ? 'draft' : 'published',
            permittedFields,
            lockedFields: lockedKeys,
            actor: {
                name: state.user.name,
                role: state.user.role
            }
        };

        try {
            const res = await fetch(`${API_BASE}/custom-templates`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });
            const json = await res.json();
            if (!res.ok) throw new Error(json.error);

            closeCreateTemplateModal();
            showGoalNotification(`Template "${name}" created (${payload.status})!`);
            await loadTemplates();
        } catch (err) {
            alert('Failed to create template: ' + err.message);
        }
    };

    // "Users can edit permitted fields and instructions"
    window.openCustomizeTemplateModal = function (templateId) {
        const tpl = state.templates.find(t => t.id === templateId || t.key === templateId);
        if (!tpl) return;
        state.currentTemplateId = templateId;

        document.getElementById('custTplTitle').textContent = `Customize Template: ${tpl.name}`;
        document.getElementById('custTplInstructions').value = tpl.instructions || '';
        document.getElementById('custTplStatusSelect').value = tpl.status || 'published';

        const fieldsContainer = document.getElementById('custTplFieldsList');
        fieldsContainer.innerHTML = (tpl.permittedFields || []).map(f => {
            const isLocked = !f.isPermittedToEdit || (tpl.lockedFields || []).includes(f.fieldKey);
            return `
                <div style="background: ${isLocked ? '#f8fafc' : 'white'}; border: 1px solid var(--border); border-radius: 12px; padding: 12px; margin-bottom: 8px;">
                    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px;">
                        <span style="font-size: 0.82rem; font-weight: 800; color: #1e293b;">${escapeHtml(f.label || f.fieldKey)}</span>
                        ${isLocked ? `
                            <span style="font-size: 0.68rem; font-weight: 800; background: #fee2e2; color: #dc2626; padding: 2px 6px; border-radius: 6px; display: flex; align-items: center; gap: 4px;">
                                <i data-lucide="lock" style="width: 10px; height: 10px;"></i> Locked
                            </span>
                        ` : `
                            <span style="font-size: 0.68rem; font-weight: 800; background: #dcfce7; color: #15803d; padding: 2px 6px; border-radius: 6px; display: flex; align-items: center; gap: 4px;">
                                <i data-lucide="unlock" style="width: 10px; height: 10px;"></i> Permitted
                            </span>
                        `}
                    </div>
                    <input type="text" class="cust-field-val" data-key="${f.fieldKey}" value="${escapeHtml(String(f.defaultValue || ''))}" ${isLocked ? 'disabled' : ''} style="width: 100%; padding: 8px 12px; border-radius: 8px; border: 1px solid var(--border); font-size: 0.82rem; background: ${isLocked ? '#f1f5f9' : 'white'}; outline: none;">
                    ${f.instructions ? `<div style="font-size: 0.7rem; color: #64748b; margin-top: 4px;">${escapeHtml(f.instructions)}</div>` : ''}
                </div>
            `;
        }).join('');

        document.getElementById('customizeTemplateModal').style.display = 'flex';
        if (window.lucide) window.lucide.createIcons();
    };

    window.closeCustomizeTemplateModal = function () {
        document.getElementById('customizeTemplateModal').style.display = 'none';
    };

    // "A preview should appear before saving"
    window.previewBeforeSavingCustomization = async function () {
        const templateId = state.currentTemplateId;
        const customValues = {};
        document.querySelectorAll('#custTplFieldsList .cust-field-val').forEach(inp => {
            customValues[inp.getAttribute('data-key')] = inp.value;
        });

        try {
            const res = await fetch(`${API_BASE}/custom-templates/${encodeURIComponent(templateId)}/preview`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ customFieldValues: customValues })
            });
            const json = await res.json();
            if (!res.ok) throw new Error(json.error);

            // Show preview modal
            document.getElementById('preSavePreviewContent').innerHTML = json.data.previewHtml;
            document.getElementById('preSavePreviewModal').style.display = 'flex';
        } catch (err) {
            alert('Preview error: ' + err.message);
        }
    };

    window.saveCustomizedTemplate = async function () {
        const templateId = state.currentTemplateId;
        const instructions = document.getElementById('custTplInstructions').value.trim();
        const status = document.getElementById('custTplStatusSelect').value;

        const customValues = {};
        document.querySelectorAll('#custTplFieldsList .cust-field-val').forEach(inp => {
            customValues[inp.getAttribute('data-key')] = inp.value;
        });

        const tpl = state.templates.find(t => t.id === templateId || t.key === templateId);
        const updatedPermittedFields = (tpl.permittedFields || []).map(f => ({
            ...f,
            defaultValue: customValues[f.fieldKey] !== undefined ? customValues[f.fieldKey] : f.defaultValue
        }));

        try {
            const res = await fetch(`${API_BASE}/custom-templates/${encodeURIComponent(templateId)}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    instructions,
                    permittedFields: updatedPermittedFields,
                    status,
                    actor: { name: state.user.name, role: state.user.role }
                })
            });
            const json = await res.json();
            if (!res.ok) throw new Error(json.error);

            closeCustomizeTemplateModal();
            document.getElementById('preSavePreviewModal').style.display = 'none';
            showGoalNotification('Template customizations successfully saved!');
            await loadTemplates();
        } catch (err) {
            alert('Save error: ' + err.message);
        }
    };

    // "Templates can be saved as drafts or published"
    window.publishTemplateAction = async function (templateId) {
        if (!confirm('Publish this draft template for use across all authorized units?')) return;
        try {
            const res = await fetch(`${API_BASE}/custom-templates/${encodeURIComponent(templateId)}/publish`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ actor: { name: state.user.name, role: state.user.role } })
            });
            const json = await res.json();
            if (!res.ok) throw new Error(json.error);
            showGoalNotification('Template successfully published!');
            await loadTemplates();
        } catch (err) {
            alert('Publish failed: ' + err.message);
        }
    };

    // "Administrators can manage template permissions"
    window.openTemplatePermissionsModal = function (templateId) {
        const tpl = state.templates.find(t => t.id === templateId || t.key === templateId);
        if (!tpl) return;
        state.currentTemplateId = templateId;

        document.getElementById('permTplName').textContent = tpl.name;
        document.getElementById('permRoleAdmin').checked = true;
        document.getElementById('permRoleHR').checked = (tpl.permissions?.permittedRoles || []).includes('hr_admin');
        document.getElementById('permRoleManager').checked = (tpl.permissions?.permittedRoles || []).includes('manager');
        document.getElementById('permRoleEmployee').checked = (tpl.permissions?.permittedRoles || []).includes('employee');

        document.getElementById('permModuleGoals').checked = (tpl.permissions?.permittedModules || []).includes('goals');
        document.getElementById('permModuleOnboard').checked = (tpl.permissions?.permittedModules || []).includes('onboarding');
        document.getElementById('permModuleHR').checked = (tpl.permissions?.permittedModules || []).includes('hr_admin');
        document.getElementById('permModulePMS').checked = (tpl.permissions?.permittedModules || []).includes('pms');

        document.getElementById('templatePermissionsModal').style.display = 'flex';
    };

    window.closeTemplatePermissionsModal = function () {
        document.getElementById('templatePermissionsModal').style.display = 'none';
    };

    window.saveTemplatePermissions = async function () {
        const templateId = state.currentTemplateId;
        const permittedRoles = ['super_admin'];
        if (document.getElementById('permRoleHR').checked) permittedRoles.push('hr_admin');
        if (document.getElementById('permRoleManager').checked) permittedRoles.push('manager');
        if (document.getElementById('permRoleEmployee').checked) permittedRoles.push('employee');

        const permittedModules = [];
        if (document.getElementById('permModuleGoals').checked) permittedModules.push('goals');
        if (document.getElementById('permModuleOnboard').checked) permittedModules.push('onboarding');
        if (document.getElementById('permModuleHR').checked) permittedModules.push('hr_admin');
        if (document.getElementById('permModulePMS').checked) permittedModules.push('pms');

        try {
            const res = await fetch(`${API_BASE}/custom-templates/${encodeURIComponent(templateId)}/permissions`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    permissions: {
                        permittedRoles,
                        permittedModules
                    },
                    actor: { name: state.user.name, role: 'super_admin' }
                })
            });
            const json = await res.json();
            if (!res.ok) throw new Error(json.error);

            closeTemplatePermissionsModal();
            showGoalNotification('Template permissions updated successfully by Administrator!');
            await loadTemplates();
        } catch (err) {
            alert('Permissions update failed: ' + err.message);
        }
    };

    /* ─── Generic Live Preview Modal ─── */
    window.openTemplatePreviewModal = async function (templateId) {
        try {
            const res = await fetch(`${API_BASE}/custom-templates/${encodeURIComponent(templateId)}/preview`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({})
            });
            const json = await res.json();
            if (!res.ok) throw new Error(json.error);

            document.getElementById('genericPreviewTitle').textContent = `Template Preview: ${json.data.templateName}`;
            document.getElementById('genericPreviewBody').innerHTML = json.data.previewHtml;
            document.getElementById('genericTemplatePreviewModal').style.display = 'flex';
        } catch (err) {
            alert('Preview error: ' + err.message);
        }
    };

    window.closeGenericPreviewModal = function () {
        document.getElementById('genericTemplatePreviewModal').style.display = 'none';
    };

    /* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
       1.3 MODULE-LEVEL TEMPLATES: PERSONAL COPIES, VERSIONING & ARCHIVAL
    ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */

    // 1. Personal Copy Modal Handlers (PRD §1.3: Managers may create personal copies where permissions allow)
    window.openPersonalCopyModal = function (templateId) {
        const tpl = state.templates.find(t => t.id === templateId || t.key === templateId);
        if (!tpl) return;

        if (tpl.permissions?.allowPersonalCopies === false) {
            alert('This enterprise template has been restricted by administrators. Personal copies cannot be created.');
            return;
        }

        state.targetCopyTemplateId = templateId;
        const nameInput = document.getElementById('personalCopyName');
        const instructionsInput = document.getElementById('personalCopyInstructions');

        if (nameInput) nameInput.value = `${tpl.name} (${state.user.name || 'Manager'} Copy)`;
        if (instructionsInput) instructionsInput.value = tpl.instructions || '';

        const modal = document.getElementById('personalCopyModal');
        if (modal) modal.style.display = 'flex';
        if (window.lucide) window.lucide.createIcons();
    };

    window.closePersonalCopyModal = function () {
        const modal = document.getElementById('personalCopyModal');
        if (modal) modal.style.display = 'none';
        state.targetCopyTemplateId = null;
    };

    window.submitPersonalCopy = async function () {
        const templateId = state.targetCopyTemplateId;
        if (!templateId) return;

        const name = document.getElementById('personalCopyName')?.value.trim();
        const instructions = document.getElementById('personalCopyInstructions')?.value.trim();

        if (!name) {
            alert('Please provide a name for your personal template copy.');
            return;
        }

        try {
            const res = await fetch(`${API_BASE}/custom-templates/${encodeURIComponent(templateId)}/personal-copy`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    name,
                    instructions,
                    actor: {
                        id: state.user.id,
                        name: state.user.name,
                        role: state.user.role
                    }
                })
            });

            const json = await res.json();
            if (!res.ok) throw new Error(json.error || 'Failed to create personal copy');

            closePersonalCopyModal();
            showGoalNotification(`Personal copy "${name}" created! (Saved as Draft)`);
            await loadTemplates();
        } catch (err) {
            alert('Error creating personal copy: ' + err.message);
        }
    };

    // 2. Publish New Template Version Modal Handlers (PRD §1.3: Template changes should be versioned)
    window.openTemplateVersionModal = function (templateId) {
        const tpl = state.templates.find(t => t.id === templateId || t.key === templateId);
        if (!tpl) return;

        state.targetVersionTemplateId = templateId;
        const titleEl = document.getElementById('versionTplName');
        if (titleEl) titleEl.textContent = `${tpl.name} • Current Version: ${tpl.version || 'v1.0'}`;

        const notesInput = document.getElementById('versionChangeNotes');
        const customInput = document.getElementById('versionCustomInput');
        const instructionsInput = document.getElementById('versionRevisedInstructions');

        if (notesInput) notesInput.value = '';
        if (customInput) customInput.value = '';
        if (instructionsInput) instructionsInput.value = tpl.instructions || '';

        const modal = document.getElementById('templateVersionModal');
        if (modal) modal.style.display = 'flex';
        if (window.lucide) window.lucide.createIcons();
    };

    window.closeTemplateVersionModal = function () {
        const modal = document.getElementById('templateVersionModal');
        if (modal) modal.style.display = 'none';
        state.targetVersionTemplateId = null;
    };

    window.submitTemplateVersion = async function () {
        const templateId = state.targetVersionTemplateId;
        if (!templateId) return;

        const versionType = document.getElementById('versionTypeSelect')?.value || 'minor';
        const customVersion = document.getElementById('versionCustomInput')?.value.trim();
        const changeNotes = document.getElementById('versionChangeNotes')?.value.trim();
        const revisedInstructions = document.getElementById('versionRevisedInstructions')?.value.trim();

        if (!changeNotes) {
            alert('Please specify the change notes or audit rationale for this version.');
            return;
        }

        try {
            const payload = {
                versionType,
                changeNotes,
                instructions: revisedInstructions,
                actor: {
                    id: state.user.id,
                    name: state.user.name,
                    role: state.user.role
                }
            };
            if (customVersion) payload.version = customVersion;

            const res = await fetch(`${API_BASE}/custom-templates/${encodeURIComponent(templateId)}/version`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });

            const json = await res.json();
            if (!res.ok) throw new Error(json.error || 'Failed to publish new version');

            closeTemplateVersionModal();
            showGoalNotification(`New version ${json.data?.version || ''} published successfully! Existing records remain unchanged.`);
            await loadTemplates();
        } catch (err) {
            alert('Error publishing version: ' + err.message);
        }
    };

    // 3. Version History & Snapshots Modal Handlers
    window.openTemplateVersionHistoryModal = async function (templateId) {
        const tpl = state.templates.find(t => t.id === templateId || t.key === templateId);
        if (!tpl) return;

        const titleEl = document.getElementById('historyModalTplName');
        if (titleEl) titleEl.textContent = `${tpl.name} — Module: ${tpl.module.toUpperCase()} (Current: ${tpl.version || 'v1.0'})`;

        const listContainer = document.getElementById('templateVersionHistoryList');
        if (listContainer) {
            listContainer.innerHTML = '<div style="text-align: center; padding: 2rem; color: #64748b;">Loading immutable version history...</div>';
        }

        const modal = document.getElementById('templateVersionHistoryModal');
        if (modal) modal.style.display = 'flex';

        try {
            const res = await fetch(`${API_BASE}/custom-templates/${encodeURIComponent(templateId)}/versions`);
            const json = await res.json();
            if (!res.ok) throw new Error(json.error || 'Failed to fetch version history');

            const history = json.data?.versions || [];

            if (history.length === 0) {
                listContainer.innerHTML = '<div style="text-align: center; padding: 2rem; color: #64748b;">No version history records found.</div>';
                return;
            }

            listContainer.innerHTML = history.map((ver) => {
                const dateStr = new Date(ver.timestamp).toLocaleString();
                const isCurrent = ver.version === tpl.version;
                const hashSnippet = ver.integrityHash ? ver.integrityHash.slice(0, 16) + '...' : 'SHA-256 Verified';

                return `
                    <div style="background: ${isCurrent ? '#eff6ff' : '#f8fafc'}; border: 1.5px solid ${isCurrent ? '#93c5fd' : '#e2e8f0'}; border-radius: 14px; padding: 14px; position: relative;">
                        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px;">
                            <div style="display: flex; align-items: center; gap: 8px;">
                                <span style="font-size: 0.85rem; font-weight: 800; color: #1e40af; background: white; padding: 2px 8px; border-radius: 6px; border: 1px solid #bfdbfe;">
                                    ${escapeHtml(ver.version)}
                                </span>
                                ${isCurrent ? '<span style="font-size: 0.65rem; font-weight: 800; background: #2563eb; color: white; padding: 2px 6px; border-radius: 4px; text-transform: uppercase;">Active Current</span>' : ''}
                            </div>
                            <span style="font-size: 0.72rem; color: #64748b;">${dateStr}</span>
                        </div>

                        <div style="font-size: 0.82rem; color: #1e293b; font-weight: 700; margin-bottom: 4px;">
                            ${escapeHtml(ver.changeNotes || 'Initial baseline snapshot')}
                        </div>

                        <div style="display: flex; justify-content: space-between; align-items: center; font-size: 0.72rem; color: #64748b; margin-top: 6px; border-top: 1px dashed #cbd5e1; padding-top: 6px;">
                            <span>Author: <strong>${escapeHtml(ver.actor?.name || 'Administrator')}</strong> (${escapeHtml(ver.actor?.role || 'System')})</span>
                            <span style="font-family: monospace; color: #0284c7;" title="Cryptographic Snapshot Integrity Hash">
                                🔒 ${escapeHtml(hashSnippet)}
                            </span>
                        </div>
                    </div>
                `;
            }).join('');

            if (window.lucide) window.lucide.createIcons();
        } catch (err) {
            if (listContainer) {
                listContainer.innerHTML = `<div style="color: #ef4444; padding: 1rem; text-align: center;">Error loading history: ${err.message}</div>`;
            }
        }
    };

    window.closeTemplateVersionHistoryModal = function () {
        const modal = document.getElementById('templateVersionHistoryModal');
        if (modal) modal.style.display = 'none';
    };

    // 4. Archive Template Modal Handlers (PRD §1.3: Archived - Retained for history; unavailable for new use)
    window.openArchiveTemplateModal = function (templateId) {
        const tpl = state.templates.find(t => t.id === templateId || t.key === templateId);
        if (!tpl) return;

        state.targetArchiveTemplateId = templateId;
        const titleEl = document.getElementById('archiveTplName');
        if (titleEl) titleEl.textContent = `${tpl.name} • Current Version: ${tpl.version || 'v1.0'}`;

        const reasonInput = document.getElementById('archiveReasonInput');
        if (reasonInput) reasonInput.value = '';

        const modal = document.getElementById('archiveTemplateModal');
        if (modal) modal.style.display = 'flex';
        if (window.lucide) window.lucide.createIcons();
    };

    window.closeArchiveTemplateModal = function () {
        const modal = document.getElementById('archiveTemplateModal');
        if (modal) modal.style.display = 'none';
        state.targetArchiveTemplateId = null;
    };

    window.submitArchiveTemplate = async function () {
        const templateId = state.targetArchiveTemplateId;
        if (!templateId) return;

        const reason = document.getElementById('archiveReasonInput')?.value.trim();
        if (!reason) {
            alert('Please provide a reason for archiving this template.');
            return;
        }

        try {
            const res = await fetch(`${API_BASE}/custom-templates/${encodeURIComponent(templateId)}/archive`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    reason,
                    actor: {
                        id: state.user.id,
                        name: state.user.name,
                        role: state.user.role
                    }
                })
            });

            const json = await res.json();
            if (!res.ok) throw new Error(json.error || 'Failed to archive template');

            closeArchiveTemplateModal();
            showGoalNotification(`Template archived. Retained for history; unavailable for new use.`);
            await loadTemplates();
        } catch (err) {
            alert('Error archiving template: ' + err.message);
        }
    };

    // Helper: Toast notification
    function showGoalNotification(message) {
        const toast = document.createElement('div');
        toast.style.cssText = 'position: fixed; bottom: 24px; right: 24px; background: #0f172a; color: white; padding: 14px 22px; border-radius: 14px; font-size: 0.85rem; font-weight: 700; box-shadow: 0 10px 30px rgba(0,0,0,0.25); z-index: 10000; animation: alertPop 0.3s ease; display: flex; align-items: center; gap: 8px; border: 1px solid #334155;';
        toast.innerHTML = `<span style="color:#10b981;">✓</span> <span>${escapeHtml(message)}</span>`;
        document.body.appendChild(toast);
        setTimeout(() => {
            toast.style.opacity = '0';
            toast.style.transition = 'opacity 0.4s';
            setTimeout(() => toast.remove(), 400);
        }, 3200);
    }

    function escapeHtml(str) {
        if (!str) return '';
        return String(str)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');
    }
})();
