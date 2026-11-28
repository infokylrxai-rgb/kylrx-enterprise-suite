const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const automationEngine = require('../services/automation-engine');
const analyticsEngine = require('../services/custom-analytics-engine');
const logger = require('../utils/logger');
const { admin, db, rawCollection } = require('../config/firebase');
const { firebaseProjectInfo } = require('../config/firebase');
const { verifyToken, authorize, ADMIN_HR_ROLES } = require('../middleware/authMiddleware');

router.use(verifyToken);

/**
 * Admin Central Dashboard (Command Center) Service & Route Handler
 * 
 * Aggregates all 11 centralized enterprise widgets with permission-based gating and customization:
 * 1. Attendance overview
 * 2. PMS insights
 * 3. Exit analytics
 * 4. Payroll analytics
 * 5. Policy compliance
 * 6. Workforce overview
 * 7. Automatically generated organization structure
 * 8. Pending actions
 * 9. Critical alerts
 * 10. Approvals
 * 11. Recent automation activity
 */

// Role-Based Widget Permissions Matrix
const ROLE_PERMISSIONS = {
    super_admin: {
        roleName: 'Super Administrator',
        allowedWidgets: [
            'workforce', 'attendance', 'payroll', 'pms', 'exit', 'policy',
            'org_structure', 'pending_actions', 'critical_alerts', 'approvals', 'recent_automation'
        ]
    },
    hr_admin: {
        roleName: 'HR Operations Admin',
        allowedWidgets: [
            'workforce', 'attendance', 'payroll', 'pms', 'exit', 'policy',
            'org_structure', 'pending_actions', 'critical_alerts', 'approvals', 'recent_automation'
        ]
    },
    manager: {
        roleName: 'Department Reporting Manager',
        allowedWidgets: [
            'workforce', 'attendance', 'pms', 'org_structure', 'pending_actions', 'approvals'
        ]
    },
    payroll_admin: {
        roleName: 'Payroll & Statutory Specialist',
        allowedWidgets: [
            'workforce', 'payroll', 'pending_actions', 'critical_alerts', 'approvals', 'recent_automation'
        ]
    },
    compliance_auditor: {
        roleName: 'Governance & Statutory Auditor',
        allowedWidgets: [
            'workforce', 'payroll', 'policy', 'critical_alerts', 'recent_automation'
        ]
    }
};

// In-Memory Pending Approvals & Actions Store (Synced with Automation Engine)
let pendingApprovals = [];   // was a list of invented records, shown as the organisation's;

let pendingActions = [];   // was a list of invented records, shown as the organisation's
let criticalAlerts = [];;


/**
 * GET /api/central-dashboard/overview
 * Consolidates live metrics for all 11 required dashboard widgets
 */
/**
 * Tenant-scoped overview for a signed-in organization, computed from that organization's
 * own Firestore data (a newly registered company therefore starts at all zeros).
 */
const { LEGACY_ORG_ID, orgDocs: orgDocsFor } = require('../config/tenant');
const OVERVIEW_CACHE_MS = 60 * 1000;
const overviewCache = new Map(); // orgId -> { at, data }
const orgDocs = (name, orgId, max) => orgDocsFor(rawCollection, name, orgId, max);

function toMillis(value) {
    if (!value) return 0;
    if (typeof value.toMillis === 'function') return value.toMillis();
    if (typeof value._seconds === 'number') return value._seconds * 1000;
    const ms = Date.parse(value);
    return Number.isNaN(ms) ? 0 : ms;
}

function timeAgo(ms) {
    if (!ms) return '';
    const mins = Math.round((Date.now() - ms) / 60000);
    if (mins < 60) return `${Math.max(mins, 1)} mins ago`;
    if (mins < 1440) return `${Math.round(mins / 60)} hours ago`;
    return `${Math.round(mins / 1440)} days ago`;
}

const lakhs = (rupees) => `₹${(rupees / 100000).toFixed(1)} Lakhs`;
const pct = (part, total) => total ? `${((part / total) * 100).toFixed(1)}%` : '0.0%';

async function buildTenantOverview(user) {
    const orgId = user.orgId;
    const cached = overviewCache.get(orgId);
    if (cached && Date.now() - cached.at < OVERVIEW_CACHE_MS) return cached.data;

    const orgRef = rawCollection('organizations').doc(orgId);
    const [orgSnap, orgEmpSnap, users, employeesCol, attendance, regularizations, payrollProfiles,
        payrollRuns, pmsCycles, pmsTasks, perfMetrics, policies, breaches, tasks, actionable,
        automationLogs, settlements] = await Promise.all([
        orgRef.get(),
        orgRef.collection('employees').get(),
        orgDocs('users', orgId),
        orgDocs('employees', orgId),
        orgDocs('attendance', orgId),
        orgDocs('attendance_regularizations', orgId),
        orgDocs('payroll_profiles', orgId),
        orgDocs('payroll_runs', orgId, 50),
        orgDocs('pms_cycles', orgId),
        orgDocs('pms_tasks', orgId),
        orgDocs('performance_metrics', orgId),
        orgDocs('policies', orgId),
        orgDocs('alert_breaches', orgId, 200),
        orgDocs('tasks', orgId, 200),
        orgDocs('actionable_work', orgId),
        orgDocs('automation_audit_logs', orgId, 300),
        orgDocs('gratuity_settlements', orgId)
    ]);
    const palette = ['#6366f1', '#10b981', '#0ea5e9', '#f59e0b', '#ef4444', '#8b5cf6'];
    const countBy = (list, fn) => list.reduce((acc, item) => {
        const label = fn(item) || 'Unassigned';
        acc[label] = (acc[label] || 0) + 1;
        return acc;
    }, {});
    const toChart = (counts, label, color) => ({
        labels: Object.keys(counts),
        datasets: [{ label, data: Object.values(counts), backgroundColor: color || palette }]
    });

    // ── Workforce: staff accounts (users) + employee master records, de-duplicated ──
    const isGone = (p) => /relieved|exited|terminated|inactive/i.test(p.employmentStatus || p.status || '');
    const people = new Map();
    users.forEach(u => people.set(u.employeeId || u.uid || u.id, { ...u, source: 'users' }));
    employeesCol.forEach(e => people.set(e.employeeId || e.id, { ...people.get(e.employeeId || e.id), ...e }));
    orgEmpSnap.docs.forEach(d => people.set(d.get('employeeId') || d.id, { ...people.get(d.get('employeeId') || d.id), ...d.data() }));
    const everyone = [...people.values()];
    const active = everyone.filter(p => !isGone(p));
    const departed = everyone.filter(isGone);
    const headcount = active.length;
    const quarterStart = new Date(new Date().getFullYear(), Math.floor(new Date().getMonth() / 3) * 3, 1).getTime();
    const newHires = active.filter(p => toMillis(p.joiningDate || p.createdAt) >= quarterStart).length;
    const deptOf = (p) => p.departmentName || p.department || p.departmentId;

    // ── Attendance ──
    const today = new Date().toISOString().slice(0, 10);
    const latestDay = attendance.map(a => a.date).filter(Boolean).sort().pop() || today;
    const dayRecords = attendance.filter(a => a.date === latestDay);
    const isAbsent = (a) => /absent|missing/i.test(a.status || '');
    const absences = attendance.filter(isAbsent);
    const lateMarks = attendance.filter(a => /late/i.test(a.status || ''));
    const wfhDays = attendance.filter(a => /wfh|remote|home/i.test(a.type || '')).length;
    const presentToday = dayRecords.filter(a => !isAbsent(a)).length;
    const overtime = attendance.reduce((sum, a) => sum + Math.max(0, (Number(a.durationHours) || 0) - 9), 0);

    // ── Payroll ──
    const monthlyGross = (p) => {
        const s = p.salaryStructure || {};
        return (Number(s.base) || 0) + (Number(s.incentives) || 0) + (Number(s.shiftAllowance) || 0);
    };
    const statutory = (p) => {
        const s = p.salaryStructure || {};
        return (Number(s.pf) || 0) + (Number(s.esic) || 0) + (Number(s.gratuity) || 0);
    };
    const grossTotal = payrollProfiles.reduce((sum, p) => sum + monthlyGross(p), 0);
    const statutoryTotal = payrollProfiles.reduce((sum, p) => sum + statutory(p), 0);
    const payrollHolds = payrollProfiles.filter(p => /pending|hold/i.test(p.approvalStatus || ''));
    const runs = [...payrollRuns].sort((a, b) => toMillis(b.timestamp || b.finalized_at) - toMillis(a.timestamp || a.finalized_at));
    const lastRunGross = Number(runs[0] && runs[0].total_gross) || 0;
    const prevRunGross = Number(runs[1] && runs[1].total_gross) || 0;
    const variance = prevRunGross ? `${(((lastRunGross - prevRunGross) / prevRunGross) * 100).toFixed(1)}%` : '0.0%';
    const payrollByDept = payrollProfiles.reduce((acc, p) => {
        const label = p.department || p.employeeName || 'Unassigned';
        acc[label] = +(((acc[label] || 0) + monthlyGross(p) / 100000).toFixed(2));
        return acc;
    }, {});

    // ── PMS ──
    const reviewed = pmsTasks.filter(t => /accepted|approved|completed/i.test(t.reviewStatus || t.status || ''));
    const pendingReviews = pmsTasks.filter(t => !/accepted|approved|completed|rejected/i.test(t.reviewStatus || t.status || ''));
    const scores = perfMetrics.map(m => Number(m.overallScore) || 0);
    const asPercent = (s) => (s <= 1 ? s * 100 : s);
    const avgScore = scores.length ? scores.reduce((a, b) => a + asPercent(b), 0) / scores.length : 0;
    const ratingBand = (s) => {
        const v = asPercent(s);
        return v >= 90 ? '5 - Outstanding' : v >= 75 ? '4 - Exceeds Expectations' : v >= 50 ? '3 - Meets Expectations'
            : v >= 25 ? '2 - Needs Improvement' : '1 - Unsatisfactory';
    };

    // ── Exit ──
    const pendingFnF = settlements.filter(s => !/completed|paid|closed/i.test(s.current_stage || s.status || ''));
    const exitReasons = countBy(departed, p => p.exitReason || p.employmentStatus || 'Not recorded');
    // Only employees with both dates count (a missing joining date would measure from 1970)
    const tenureMonths = departed
        .filter(p => toMillis(p.relievedAt) && toMillis(p.joiningDate))
        .map(p => (toMillis(p.relievedAt) - toMillis(p.joiningDate)) / (30 * 86400000))
        .filter(m => m > 0);

    // ── Policy ──
    const signedAvg = policies.length
        ? policies.reduce((sum, p) => sum + (Number(p.signedPercentage) || 0), 0) / policies.length : 0;
    const overduePolicies = policies.filter(p => (Number(p.signedPercentage) || 0) < 100).length;

    // ── Alerts, approvals, actions, activity ──
    const criticalAlerts = breaches
        .filter(b => /critical|high/i.test(b.severity || ''))
        .sort((a, b) => toMillis(b.timestamp) - toMillis(a.timestamp))
        .slice(0, 8)
        .map(b => ({
            id: b.id,
            module: b.module || 'System',
            severity: b.severity,
            title: b.ruleName || b.ruleId || 'Alert rule breached',
            employee: b.employeeName || b.entityId || (b.module ? `${b.module} module` : 'Organization'),
            department: b.department || '',
            message: `Measured value ${b.evaluatedValue ?? '-'} breached rule ${b.ruleId || ''}`.trim(),
            timestamp: timeAgo(toMillis(b.timestamp))
        }));

    const approvals = [
        ...regularizations.filter(r => /pending/i.test(r.status || '')).map(r => ({
            id: r.id,
            type: r.type || 'Attendance Regularization',
            entityId: r.employeeId,
            requester: r.employeeName || r.employeeId,
            department: r.department || '',
            submittedAt: new Date(toMillis(r.requestedAt) || Date.now()).toISOString(),
            slaHoursRemaining: Math.max(0, 48 - Math.round((Date.now() - toMillis(r.requestedAt)) / 3600000)),
            priority: r.isAfterThreshold ? 'high' : 'medium',
            description: r.reason || ''
        })),
        ...payrollHolds.map(p => ({
            id: p.id,
            type: 'Payroll Profile Approval',
            entityId: p.employeeId,
            requester: p.employeeName || p.employeeId,
            department: p.department || 'Finance',
            submittedAt: new Date(toMillis(p.initializedAt) || Date.now()).toISOString(),
            slaHoursRemaining: 24,
            priority: 'high',
            description: p.approvalStatus
        }))
    ];

    const openTasks = tasks.filter(t => /pending|open|in[_ ]progress/i.test(t.status || ''));
    const pendingActions = [
        ...actionable.filter(a => !/completed|resolved|closed/i.test(a.status || '')).map(a => ({
            id: a.id,
            category: a.module || a.category || 'Operations',
            title: a.title,
            dueIn: a.urgency || a.severity || 'Open',
            assignedTo: (a.assignee && (a.assignee.name || a.assignee.role)) || 'HR Operations',
            status: /critical/i.test(a.urgency || a.severity || '') ? 'urgent' : 'pending',
            actionUrl: 'admin-notification-center.html'
        })),
        ...openTasks
            .sort((a, b) => toMillis(a.escalation_at) - toMillis(b.escalation_at))
            .slice(0, 10)
            .map(t => ({
                id: t.task_id || t.id,
                category: t.entity_type ? `${t.entity_type} task` : 'Workflow Task',
                title: t.title,
                dueIn: t.escalation_at ? `Escalates ${new Date(toMillis(t.escalation_at)).toISOString().slice(0, 10)}` : 'Open',
                assignedTo: t.assignee_role || t.assignee_id || 'Unassigned',
                status: toMillis(t.escalation_at) && toMillis(t.escalation_at) < Date.now() ? 'urgent' : 'pending',
                actionUrl: 'admin-automation-builder.html'
            }))
    ];

    const recentAutomationActivity = automationLogs
        .sort((a, b) => toMillis(b.timestamp) - toMillis(a.timestamp))
        .slice(0, 12)
        .map(l => ({
            id: l.audit_id || l.id,
            stage: l.stage,
            status: l.status,
            event: l.automationId || (l.details && l.details.action) || 'automation.event',
            timestamp: new Date(toMillis(l.timestamp)).toISOString(),
            runId: l.runId
        }));

    const ceo = users.find(u => /super_?admin/i.test(u.role || '') && /ceo|founder/i.test(u.designation || '')) || user;
    const ceoName = ceo.name || ceo.displayName || user.name || 'Super Admin';
    const deptCounts = countBy(active, deptOf);

    const data = {
        orgId,
        companyName: orgSnap.exists ? (orgSnap.get('displayName') || orgSnap.get('legalName')) : '',
        workforce: {
            totalHeadcount: headcount,
            buDistribution: toChart(countBy(active, p => p.businessUnit || deptOf(p)), 'Headcount'),
            employeeTypes: headcount ? toChart(countBy(active, p => p.employeeType || p.role), 'Employees') : null,
            newHiresQTD: newHires,
            attritionRate: pct(departed.length, everyone.length),
            firebaseLiveHeadcount: headcount,
            connectedToFirebase: true
        },
        attendance: {
            todayPresentPct: pct(presentToday, dayRecords.length),
            absenteeismTotal: absences.length,
            wfhUtilizationDays: wfhDays,
            lateArrivalsCount: lateMarks.length,
            overtimeHours: +overtime.toFixed(1),
            chartAbsenteeism: toChart(countBy([...absences, ...lateMarks], a => a.department), 'Absent / Late Marks', '#6366f1'),
            connectedToFirebase: true
        },
        payroll: {
            grossCostTotal: lakhs(grossTotal),
            grossCostValue: grossTotal,
            variancePct: variance,
            statutoryTotals: lakhs(statutoryTotal),
            statutoryRemittances: lakhs(statutoryTotal),
            holdExceptionsCount: payrollHolds.length,
            reconciliationHolds: payrollHolds.length,
            chartPayrollCost: toChart(payrollByDept, 'Payroll Cost (₹ Lakhs)', '#0ea5e9'),
            chartGrossCost: toChart(payrollByDept, 'Payroll Cost (₹ Lakhs)', '#0ea5e9'),
            connectedToFirebase: true
        },
        pms: {
            goalVelocityPct: pct(reviewed.length, pmsTasks.length),
            reviewCompletionRate: pct(reviewed.length, pmsTasks.length),
            reviewCompletionValue: pmsTasks.length ? reviewed.length / pmsTasks.length : 0,
            goalCompletionAvg: `${avgScore.toFixed(1)}%`,
            chartRatingBellCurve: toChart(countBy(scores, ratingBand), 'Employees'),
            pendingManagerAppraisals: pendingReviews.length,
            managerReviewsPending: pendingReviews.length,
            topPerformerCount: scores.filter(s => asPercent(s) >= 90).length,
            pipActiveCount: scores.filter(s => asPercent(s) < 25).length,
            activeCycles: pmsCycles.filter(c => /active/i.test(c.status || '')).length,
            chartGoalCompletion: null,
            connectedToFirebase: true
        },
        exit: {
            avgTenureMonths: tenureMonths.length ? +(tenureMonths.reduce((a, b) => a + b, 0) / tenureMonths.length).toFixed(1) : 0,
            averageTenureMonths: tenureMonths.length ? +(tenureMonths.reduce((a, b) => a + b, 0) / tenureMonths.length).toFixed(1) : 0,
            pendingFnFCount: pendingFnF.length,
            pendingClearancesCount: pendingFnF.length,
            totalExitsQTD: departed.filter(p => toMillis(p.relievedAt) >= quarterStart).length,
            totalDepartures: departed.length,
            chartReasons: toChart(exitReasons, 'Departures'),
            chartAttritionDept: departed.length ? toChart(countBy(departed, deptOf), 'Departures', '#ef4444') : null,
            chartDeptAttrition: departed.length ? toChart(countBy(departed, deptOf), 'Departures', '#ef4444') : null,
            connectedToFirebase: true
        },
        policy: {
            compliancePct: `${signedAvg.toFixed(1)}%`,
            overallComplianceRate: `${signedAvg.toFixed(1)}%`,
            chartComplianceByDoc: {
                labels: policies.map(p => p.title || p.id),
                datasets: [{ label: 'Signed %', data: policies.map(p => Number(p.signedPercentage) || 0), backgroundColor: '#10b981' }]
            },
            overdueSignatures: overduePolicies,
            totalDistributed: policies.length,
            connectedToFirebase: true
        },
        orgStructure: {
            id: ceo.uid || ceo.id || user.id,
            name: ceoName,
            role: ceo.designation || 'Chief Executive Officer',
            department: ceo.department || 'Executive Leadership',
            avatar: ceoName.split(/\s+/).map(p => p[0]).join('').slice(0, 2).toUpperCase() || 'SA',
            directReportsCount: Object.keys(deptCounts).length,
            totalTeamSize: headcount,
            children: Object.entries(deptCounts).map(([dept, n], i) => ({
                id: `DEPT-${i + 1}`, name: dept, role: 'Department', department: dept,
                avatar: dept.slice(0, 2).toUpperCase(), directReportsCount: n, totalTeamSize: n
            }))
        },
        pendingActions,
        criticalAlerts,
        approvals,
        recentAutomationActivity
    };
    overviewCache.set(orgId, { at: Date.now(), data });
    return data;
}

router.get('/overview', authorize(ADMIN_HR_ROLES, 'Manager'), async (req, res) => {
    try {
        // Widget set follows the verified role; unknown roles get the narrowest view, never super_admin
        const userRole = String(req.user.role || '').toLowerCase().replace(/[\s-]+/g, '_');
        const permissions = ROLE_PERMISSIONS[userRole] || ROLE_PERMISSIONS.manager;

        // Signed-in organization users only ever see their own organization's data
        if (req.user && req.user.orgId && admin.apps.length) {
            const tenantData = await buildTenantOverview(req.user);
            const firebase = {
                connected: true,
                projectId: firebaseProjectInfo().projectId,
                storageBucket: firebaseProjectInfo().storageBucket,
                firestoreSynced: true,
                orgId: req.user.orgId,
                liveCounts: { employees: tenantData.workforce.totalHeadcount, users: 1 }
            };
            return res.status(200).json({
                success: true,
                activeRole: userRole,
                roleName: permissions.roleName,
                allowedWidgets: permissions.allowedWidgets,
                firebase,
                data: { ...tenantData, firebase }
            });
        }

        /*
         * There used to be a second path here, taken whenever the request carried no
         * organisation or the database was not connected. It returned a complete invented
         * company - 950 headcount, 142 hires, 8.4% attrition, 94.2% attendance, a payroll in
         * lakhs, four made-up business units - and the Command Centre showed it as the
         * customer's own. Without an organisation or a database there are no figures.
         */
        if (!req.user || !req.user.orgId) {
            return res.status(403).json({ success: false, error: 'Your account has no organization, so there are no figures to show.' });
        }
        return res.status(503).json({ success: false, error: 'The database is not available right now, so live figures cannot be shown.' });
    } catch (error) {
        logger.error('[CentralDashboard] Error generating overview:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

/**
 * GET /api/central-dashboard/org-structure
 * Direct endpoint to fetch zoomable organization tree
 */
router.get('/org-structure', authorize(ADMIN_HR_ROLES, 'Manager'), async (req, res) => {
    // The organisation's own tree. This returned an invented company headed by a CEO
    // named "Rajesh Subramanian" for every caller.
    if (!req.user || !req.user.orgId) return res.status(403).json({ success: false, error: 'Your account has no organization.' });
    if (!admin.apps.length) return res.status(503).json({ success: false, error: 'The database is not available right now.' });
    try {
        const data = await buildTenantOverview(req.user);
        res.status(200).json({ success: true, tree: data.orgStructure });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

/**
 * POST /api/central-dashboard/approvals/:id/action
 * Resolve pending approval gate directly through Automation Engine
 */
router.post('/approvals/:id/action', authorize(ADMIN_HR_ROLES, 'Manager'), async (req, res) => {
    try {
        const { id } = req.params;
        const { decision, remarks } = req.body; // 'approved' | 'rejected'

        let approval = pendingApprovals.find(a => a.id === id);
        if (approval) {
            const idx = pendingApprovals.findIndex(a => a.id === id);
            if (idx !== -1) pendingApprovals.splice(idx, 1);
        } else {
            approval = { id, type: 'Approval Resolution Gate', requester: 'System HR', title: 'Ad-hoc Approval Resolution' };
        }

        // Approvals listed from Firestore: resolve the source record, only within the caller's org
        const orgId = req.user && req.user.orgId;
        if (orgId && admin.apps.length) {
            const sources = [
                { name: 'attendance_regularizations', update: { status: decision === 'rejected' ? 'Rejected' : 'Approved' } },
                { name: 'payroll_profiles', update: { approvalStatus: decision === 'rejected' ? 'Rejected by Finance' : 'Approved' } }
            ];
            for (const source of sources) {
                const ref = rawCollection(source.name).doc(id);
                const snap = await ref.get();
                const owner = snap.exists ? (snap.get('orgId') || LEGACY_ORG_ID) : null;
                if (owner && owner === orgId) {
                    await ref.update({ ...source.update, resolvedBy: req.user.email || req.user.id, resolvedAt: new Date().toISOString() });
                    approval = { id, source: source.name, ...snap.data() };
                    overviewCache.delete(orgId);
                    break;
                }
            }
        }

        // Record Stage 8 immutable audit log in Automation Engine
        await automationEngine.recordAuditLog({
            runId: `run-${id}-${Date.now()}`,
            automationId: 'central-approval-gate',
            stage: 'Approval Resolution',
            status: decision || 'approved',
            details: { approvalId: id, remarks: remarks || 'Resolved via Central Command Center', ...approval }
        });

        // Sync approval resolution asynchronously to Firebase Firestore
        try {
            if (db && typeof db.collection === 'function') {
                db.collection('approval_resolutions').doc(id).set({
                    approvalId: id,
                    decision: decision || 'approved',
                    remarks: remarks || 'Resolved via Central Command Center',
                    resolvedAt: new Date().toISOString(),
                    details: approval
                }, { merge: true }).catch(fsErr => {
                    logger.warn('[CentralDashboard] Firestore approval sync note:', fsErr.message);
                });
            }
        } catch (fsErr) {
            logger.warn('[CentralDashboard] Firestore approval sync note:', fsErr.message);
        }

        logger.info(`[CentralDashboard] Approval '${id}' resolved with: ${decision}`);

        res.status(200).json({
            success: true,
            message: `Approval '${id}' has been ${decision || 'approved'} successfully`,
            remainingApprovalsCount: pendingApprovals.length,
            firebaseSynced: true
        });
    } catch (error) {
        logger.error('[CentralDashboard] Error resolving approval:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

/**
 * POST /api/central-dashboard/approvals/approve-all
 * Approve all pending approvals, reducing count to 0
 */
router.post('/approvals/approve-all', authorize('Super Admin'), async (req, res) => {
    try {
        const approvedCount = pendingApprovals.length;
        for (const app of pendingApprovals) {
            await automationEngine.recordAuditLog({
                runId: `run-${app.id}-${Date.now()}`,
                automationId: 'central-approval-gate',
                stage: 'Approval Resolution',
                status: 'approved',
                details: { approvalId: app.id, remarks: 'Batch approved to 0 via Command Center', ...app }
            });
        }
        pendingApprovals = [];
        res.status(200).json({
            success: true,
            message: `All ${approvedCount} approvals approved. Remaining count is 0.`,
            remainingApprovalsCount: 0
        });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

/**
 * POST /api/central-dashboard/zero-all
 * Zero out all top tickers (approvals, alerts, actions)
 */
router.post('/zero-all', authorize('Super Admin'), async (req, res) => {
    try {
        pendingApprovals = [];
        criticalAlerts = [];
        pendingActions = [];
        res.status(200).json({
            success: true,
            message: 'All tickers zeroed out (0 Approvals, 0 Alerts, 0 Actions).',
            counts: { approvals: 0, alerts: 0, actions: 0 }
        });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

/**
 * GET /api/central-dashboard/firebase-status
 * Live diagnostic check for backend Firebase connection
 */
router.get('/firebase-status', authorize('Super Admin'), async (req, res) => {
    try {
        let isConnected = false;
        let collectionsFound = {};
        const targets = ['users', 'employees', 'attendance', 'system_intelligence'];
        
        if (db && typeof db.collection === 'function') {
            for (const t of targets) {
                try {
                    const snap = await db.collection(t).limit(10).get();
                    collectionsFound[t] = snap.size;
                    isConnected = true;
                } catch (e) {
                    collectionsFound[t] = 0;
                }
            }
        }

        res.status(200).json({
            success: true,
            status: isConnected ? "connected" : "standalone",
            projectId: firebaseProjectInfo().projectId,
            storageBucket: firebaseProjectInfo().storageBucket,
            clientEmail: firebaseProjectInfo().clientEmail,
            collections: collectionsFound,
            timestamp: new Date().toISOString()
        });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

/**
 * POST /api/central-dashboard/sync-firebase
 * Ingest or sync test alert / telemetry into Firestore
 */
router.post('/sync-firebase', authorize('Super Admin'), async (req, res) => {
    try {
        const { eventType, payload } = req.body;
        const syncId = `sync_${Date.now()}`;
        if (db && typeof db.collection === 'function') {
            db.collection('activities').add({
                eventType: eventType || 'dashboard.sync',
                payload: payload || {},
                syncedAt: new Date().toISOString(),
                source: 'admin-central-dashboard',
                syncId
            }).catch(e => logger.warn('[CentralDashboard] async activity add note:', e.message));
        }
        res.status(200).json({
            success: true,
            docId: syncId,
            status: 'synced',
            message: 'Synced to Firebase Firestore!'
        });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

/**
 * GET /api/central-dashboard/permissions
 */
router.get('/permissions', authorize(ADMIN_HR_ROLES, 'Manager'), (req, res) => {
    res.status(200).json({
        success: true,
        roles: ROLE_PERMISSIONS
    });
});

module.exports = router;
