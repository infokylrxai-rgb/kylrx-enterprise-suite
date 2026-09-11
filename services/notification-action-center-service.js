const crypto = require('crypto');
const automationEngine = require('./automation-engine');
const logger = require('../utils/logger');
const { db } = require('../config/firebase');

/**
 * Enterprise Notification & Action Centre Service
 * 
 * Separates information from actionable work:
 * - Actionable Work: Every item strictly supports:
 *     - dueTime (hard deadline timestamp)
 *     - reminderTime (automated reminder timestamp)
 *     - escalationTime (SLA breach escalation timestamp)
 *     - assignee ({ id, name, role })
 *     - status ('pending' | 'in_progress' | 'completed' | 'escalated' | 'snoozed')
 * - Information: Non-blocking notices, broadcasts, system health, and read receipts.
 * 
 * Supported Facets (11 Core Dimensions):
 * 1. Critical
 * 2. Due Today
 * 3. Upcoming
 * 4. Approvals
 * 5. Attendance
 * 6. Payroll
 * 7. PMS
 * 8. Policy
 * 9. Exit
 * 10. Documents
 * 11. System
 */

class NotificationActionCenterService {
    constructor() {
        this.actionableItems = new Map();
        this.informationalNotices = new Map();
        this.initializeDefaultData();
    }

    /**
     * Compute dynamic ISO times relative to current execution time
     */
    getTimeOffset(hoursFromNow) {
        const d = new Date();
        d.setHours(d.getHours() + hoursFromNow);
        return d.toISOString();
    }

    /**
     * Seed enterprise operational items across all 11 prompt dimensions
     */
    initializeDefaultData() {
        const now = new Date();
        const endOfToday = new Date();
        endOfToday.setHours(23, 59, 59, 999);

        // Pre-seed Actionable Work Items
        const sampleActions = [
            // 1. Critical & Attendance
            {
                id: 'ACT-ATT-001',
                title: '3 Consecutive Absences Breach (Priya Sharma)',
                description: 'Employee EMP-882 recorded 3 unexcused consecutive absences. Requires manager investigation or formal HR sanction.',
                type: 'actionable',
                category: 'attendance',
                severity: 'critical',
                dueTime: this.getTimeOffset(2), // 2 hours from now
                reminderTime: this.getTimeOffset(-1), // Reminder fired 1h ago
                escalationTime: this.getTimeOffset(4), // Escalates in 4h
                assignee: { id: 'USR-MGR-101', name: 'Kavita Krishnamurthy', role: 'Engineering Director' },
                status: 'pending',
                urgency: 'critical',
                module: 'Attendance',
                actionOptions: ['approve', 'reject', 'resolve', 'remind', 'escalate'],
                details: { employeeId: 'EMP-882', employeeName: 'Priya Sharma', department: 'Technology', absencesCount: 3 }
            },

            // 2. Critical & Payroll
            {
                id: 'ACT-PAY-002',
                title: 'Payroll Variance > 10% Pre-Disbursement Hold',
                description: 'MoM Gross Variance calculated at 12.4% (Threshold: 10%). Review variance report and authorize disbursement release.',
                type: 'actionable',
                category: 'payroll',
                severity: 'critical',
                dueTime: this.getTimeOffset(3),
                reminderTime: this.getTimeOffset(-0.5),
                escalationTime: this.getTimeOffset(6),
                assignee: { id: 'USR-PAY-201', name: 'Vikram Sengupta', role: 'Chief Financial Controller' },
                status: 'pending',
                urgency: 'critical',
                module: 'Payroll',
                actionOptions: ['approve', 'reject', 'resolve', 'escalate'],
                details: { batchId: 'BATCH-SEP-FINAL', variancePercentage: '12.4%', threshold: '10%' }
            },

            // 3. Critical & Exit
            {
                id: 'ACT-EXIT-003',
                title: 'Exit Department Clearance SLA Breach (> 48h Delayed)',
                description: 'Department clearance for resigning Lead Architect Ananya Rao stalled for 52 hours. Departmental signoff mandatory for F&F.',
                type: 'actionable',
                category: 'exit',
                severity: 'critical',
                dueTime: this.getTimeOffset(-4), // Past due -> critical
                reminderTime: this.getTimeOffset(-24),
                escalationTime: this.getTimeOffset(1),
                assignee: { id: 'USR-OPS-301', name: 'Swati Khandelwal', role: 'Chief People Officer' },
                status: 'escalated',
                urgency: 'critical',
                module: 'Exit',
                actionOptions: ['approve', 'resolve', 'escalate'],
                details: { employeeId: 'EMP-771', employeeName: 'Ananya Rao', delayedHours: 52, department: 'Finance & Accounts' }
            },

            // 4. Due Today & Approvals & PMS
            {
                id: 'ACT-PMS-004',
                title: 'Annual Performance Appraisal Rating Sign-Off',
                description: 'Final appraisal rating calibration pending for Q3 cycle. 18 team evaluations awaiting manager sign-off.',
                type: 'actionable',
                category: 'pms',
                severity: 'high',
                dueTime: endOfToday.toISOString(), // Due Today
                reminderTime: this.getTimeOffset(-2),
                escalationTime: this.getTimeOffset(12),
                assignee: { id: 'USR-MGR-402', name: 'Sunil Manchanda', role: 'VP of Commercial Sales' },
                status: 'pending',
                urgency: 'due_today',
                module: 'PMS',
                actionOptions: ['approve', 'reject', 'resolve', 'remind'],
                details: { cycle: 'Q3-2026', pendingAppraisals: 18, department: 'Enterprise Sales' }
            },

            // 5. Due Today & Documents
            {
                id: 'ACT-DOC-005',
                title: 'Candidate PAN & Aadhaar Document Re-verification',
                description: '3 newly hired engineers uploaded blurry KYC documents requiring manual compliance officer verification before day 1.',
                type: 'actionable',
                category: 'documents',
                severity: 'medium',
                dueTime: endOfToday.toISOString(), // Due Today
                reminderTime: this.getTimeOffset(-3),
                escalationTime: this.getTimeOffset(8),
                assignee: { id: 'USR-CMP-501', name: 'Naveen Jindal', role: 'Onboarding Specialist' },
                status: 'in_progress',
                urgency: 'due_today',
                module: 'Documents',
                actionOptions: ['resolve', 'remind', 'escalate'],
                details: { candidatesCount: 3, documentTypes: ['PAN Card', 'Aadhaar Card', 'Cancelled Cheque'] }
            },

            // 6. Due Today & Approvals
            {
                id: 'ACT-APP-006',
                title: 'Senior Staff Promotion & Compensation Revision Approval',
                description: 'Maker-Checker compensation adjustment gate: Grade L5 revision for Lead Cloud Architect with +18% CTC increase.',
                type: 'actionable',
                category: 'approvals',
                severity: 'high',
                dueTime: endOfToday.toISOString(), // Due Today
                reminderTime: this.getTimeOffset(-4),
                escalationTime: this.getTimeOffset(14),
                assignee: { id: 'USR-HR-601', name: 'Rajesh Subramanian', role: 'Head of People Operations' },
                status: 'pending',
                urgency: 'due_today',
                module: 'Approvals',
                actionOptions: ['approve', 'reject', 'escalate'],
                details: { employeeId: 'EMP-410', role: 'Lead Cloud Architect', salaryIncrementPct: '18%' }
            },

            // 7. Upcoming & Policy
            {
                id: 'ACT-POL-007',
                title: 'Annual Prevention of Sexual Harassment (POSH) Acknowledgment',
                description: 'Annual mandatory company-wide POSH policy attestation and digital signature campaign for 45 pending employees.',
                type: 'actionable',
                category: 'policy',
                severity: 'medium',
                dueTime: this.getTimeOffset(72), // Due in 3 days
                reminderTime: this.getTimeOffset(24),
                escalationTime: this.getTimeOffset(96),
                assignee: { id: 'USR-CMP-701', name: 'Pooja Agarwal', role: 'Statutory Compliance Lead' },
                status: 'pending',
                urgency: 'upcoming',
                module: 'Policy',
                actionOptions: ['remind', 'resolve'],
                details: { policyId: 'POL-POSH-2026', pendingRecipients: 45, complianceRate: '92.4%' }
            },

            // 8. Upcoming & Approvals & Exit
            {
                id: 'ACT-EXIT-008',
                title: 'Full & Final (F&F) Settlement Signoff & Gratuity Disbursement',
                description: 'Final clearance approved. F&F calculation voucher ₹1,42,500 requires checker signoff prior to bank disbursement.',
                type: 'actionable',
                category: 'exit',
                severity: 'high',
                dueTime: this.getTimeOffset(48), // Due in 2 days
                reminderTime: this.getTimeOffset(12),
                escalationTime: this.getTimeOffset(72),
                assignee: { id: 'USR-FIN-801', name: 'Deepa Narang', role: 'Finance Disbursement Officer' },
                status: 'pending',
                urgency: 'upcoming',
                module: 'Exit',
                actionOptions: ['approve', 'reject', 'resolve'],
                details: { settlementAmount: 142500, employeeId: 'EMP-99', noticePayAdjusted: true }
            },

            // 9. Upcoming & System
            {
                id: 'ACT-SYS-009',
                title: 'Monthly EPFO ECR Electronic Return Reconciliation & Upload',
                description: 'Pre-submission validation gate: verify UAN coverage and ECR #~# hash match before official portal upload.',
                type: 'actionable',
                category: 'system',
                severity: 'medium',
                dueTime: this.getTimeOffset(96), // Due in 4 days
                reminderTime: this.getTimeOffset(48),
                escalationTime: this.getTimeOffset(120),
                assignee: { id: 'USR-PF-901', name: 'Manish Malhotra', role: 'PF Statutory Custodian' },
                status: 'pending',
                urgency: 'upcoming',
                module: 'System',
                actionOptions: ['resolve', 'remind'],
                details: { batchId: 'ECR-SEP-2026', totalRemittance: 1845000, membersCount: 382 }
            }
        ];

        sampleActions.forEach(action => {
            this.actionableItems.set(action.id, action);
        });

        // Pre-seed Informational Notices (No action required)
        const sampleNotices = [
            {
                id: 'INF-NOTIF-101',
                title: 'Automated Daily Attendance Sync Completed',
                description: 'Biometric and geo-fenced mobile punches for 1,734 employees synchronized with zero sync errors.',
                type: 'information',
                category: 'attendance',
                severity: 'info',
                timestamp: this.getTimeOffset(-0.5),
                isRead: false,
                sender: 'Attendance Ingestion Gateway',
                module: 'Attendance'
            },
            {
                id: 'INF-NOTIF-102',
                title: 'Statutory ESIC Contribution Return Generated',
                description: 'ESIC monthly Form 5 contribution report for 238 covered employees generated and archived into statutory vault.',
                type: 'information',
                category: 'payroll',
                severity: 'success',
                timestamp: this.getTimeOffset(-2),
                isRead: false,
                sender: 'ESIC Automation Engine',
                module: 'Payroll'
            },
            {
                id: 'INF-NOTIF-103',
                title: 'New Information Security Policy Published',
                description: 'Version 3.4 of the Corporate Information Security Policy has been published to the self-service employee portal.',
                type: 'information',
                category: 'policy',
                severity: 'info',
                timestamp: this.getTimeOffset(-6),
                isRead: true,
                sender: 'Policy Compliance Orchestrator',
                module: 'Policy'
            },
            {
                id: 'INF-NOTIF-104',
                title: 'Quarterly Automated Backup Verification Passed',
                description: 'Encrypted document vault snapshot and employee record hashes verified with SHA-256 zero-loss integrity.',
                type: 'information',
                category: 'system',
                severity: 'success',
                timestamp: this.getTimeOffset(-14),
                isRead: true,
                sender: 'System Reliability Engine',
                module: 'System'
            },
            {
                id: 'INF-NOTIF-105',
                title: '5 Candidates Provisioned in Active Directory',
                description: 'Corporate email addresses and SSO groups provisioned automatically following background verification clearance.',
                type: 'information',
                category: 'documents',
                severity: 'info',
                timestamp: this.getTimeOffset(-20),
                isRead: true,
                sender: 'Onboarding Module Adapter',
                module: 'Documents'
            }
        ];

        sampleNotices.forEach(notice => {
            this.informationalNotices.set(notice.id, notice);
        });

        logger.info(`[NotificationActionCenter] Initialized with ${this.actionableItems.size} actionable items and ${this.informationalNotices.size} informational notices.`);
    }

    /**
     * Compute dynamic timeframe urgency for an actionable item
     */
    computeTimeUrgency(item) {
        if (item.severity === 'critical' || item.status === 'escalated') return 'critical';
        
        const now = new Date();
        const due = new Date(item.dueTime);
        const endOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);

        if (due <= endOfToday) {
            return due < now ? 'critical' : 'due_today';
        }
        return 'upcoming';
    }

    /**
     * Fetch feed with filters across all 11 prompt facets
     */
    getFeed({ type = 'all', facet = 'all', category = 'all', status = 'all', search = '' }) {
        let actionable = Array.from(this.actionableItems.values());
        let informational = Array.from(this.informationalNotices.values());

        // Update dynamic urgency
        actionable = actionable.map(item => ({
            ...item,
            urgency: this.computeTimeUrgency(item)
        }));

        // Search Filter
        if (search) {
            const term = search.toLowerCase();
            actionable = actionable.filter(item => 
                item.title.toLowerCase().includes(term) ||
                item.description.toLowerCase().includes(term) ||
                (item.assignee?.name && item.assignee.name.toLowerCase().includes(term))
            );
            informational = informational.filter(item =>
                item.title.toLowerCase().includes(term) ||
                item.description.toLowerCase().includes(term)
            );
        }

        // Status Filter
        if (status !== 'all') {
            actionable = actionable.filter(item => item.status === status);
        }

        // Category Filter (Attendance, Payroll, PMS, Policy, Exit, Documents, System, Approvals)
        if (category !== 'all') {
            const catLower = category.toLowerCase();
            actionable = actionable.filter(item => 
                item.category.toLowerCase() === catLower ||
                (catLower === 'approvals' && (item.category === 'approvals' || item.actionOptions.includes('approve')))
            );
            informational = informational.filter(item => item.category.toLowerCase() === catLower);
        }

        // Urgency / Facet Filter (Critical, Due Today, Upcoming, Approvals, Attendance, Payroll, PMS, Policy, Exit, Documents, System)
        if (facet !== 'all') {
            const facetLower = facet.toLowerCase();
            if (facetLower === 'critical') {
                actionable = actionable.filter(item => item.urgency === 'critical');
                informational = informational.filter(item => item.severity === 'critical');
            } else if (facetLower === 'due_today' || facetLower === 'due today') {
                actionable = actionable.filter(item => item.urgency === 'due_today');
            } else if (facetLower === 'upcoming') {
                actionable = actionable.filter(item => item.urgency === 'upcoming');
            } else if (facetLower === 'approvals') {
                actionable = actionable.filter(item => item.category === 'approvals' || item.actionOptions.includes('approve'));
            } else {
                // Module-specific facet
                actionable = actionable.filter(item => item.category.toLowerCase() === facetLower);
                informational = informational.filter(item => item.category.toLowerCase() === facetLower);
            }
        }

        // Type filter (actionable vs information)
        let resultActionable = actionable;
        let resultInformational = informational;

        if (type === 'actionable') {
            resultInformational = [];
        } else if (type === 'information' || type === 'informational') {
            resultActionable = [];
        }

        return {
            actionable: resultActionable,
            informational: resultInformational,
            totalActionable: resultActionable.length,
            totalInformational: resultInformational.length
        };
    }

    /**
     * Get KPI counts across all 11 prompt facets
     */
    getSummary() {
        const actionable = Array.from(this.actionableItems.values()).map(item => ({
            ...item,
            urgency: this.computeTimeUrgency(item)
        }));
        const informational = Array.from(this.informationalNotices.values());

        return {
            totalActionable: actionable.length,
            totalInformational: informational.length,
            unreadInformational: informational.filter(n => !n.isRead).length,

            // Urgency Dimensions
            critical: actionable.filter(i => i.urgency === 'critical').length,
            dueToday: actionable.filter(i => i.urgency === 'due_today').length,
            upcoming: actionable.filter(i => i.urgency === 'upcoming').length,

            // Functional / Module Dimensions
            approvals: actionable.filter(i => i.category === 'approvals' || i.actionOptions.includes('approve')).length,
            attendance: actionable.filter(i => i.category === 'attendance').length,
            payroll: actionable.filter(i => i.category === 'payroll').length,
            pms: actionable.filter(i => i.category === 'pms').length,
            policy: actionable.filter(i => i.category === 'policy').length,
            exit: actionable.filter(i => i.category === 'exit').length,
            documents: actionable.filter(i => i.category === 'documents').length,
            system: actionable.filter(i => i.category === 'system').length
        };
    }

    /**
     * Resolve an Actionable Item (Approve, Reject, Complete)
     */
    async resolveAction(id, { decision = 'approved', remarks = '', actor = 'HR Administrator' }) {
        const item = this.actionableItems.get(id);
        if (!item) {
            throw new Error(`Actionable item '${id}' not found`);
        }

        const newStatus = decision === 'rejected' ? 'rejected' : 'completed';
        item.status = newStatus;
        item.resolvedAt = new Date().toISOString();
        item.resolvedBy = actor;
        item.resolutionRemarks = remarks;

        this.actionableItems.set(id, item);

        // Record immutable Stage 8 audit log in Automation Engine
        try {
            await automationEngine.recordAuditLog({
                runId: `act-run-${id}`,
                automationId: `notification-action-${item.category}`,
                stage: 'Action Resolution',
                status: decision,
                details: {
                    actionId: id,
                    category: item.category,
                    title: item.title,
                    decision,
                    remarks,
                    actor,
                    resolvedAt: item.resolvedAt
                }
            });
        } catch (e) {
            logger.warn(`[NotificationActionCenter] Audit log warning: ${e.message}`);
        }

        logger.info(`[NotificationActionCenter] Action '${id}' resolved with decision '${decision}' by ${actor}.`);
        this.syncToFirebase('actionable_work', id, item);
        return item;
    }

    /**
     * Trigger Reminder Nudge
     */
    async triggerReminder(id, { actor = 'System Remind Engine' } = {}) {
        const item = this.actionableItems.get(id);
        if (!item) {
            throw new Error(`Actionable item '${id}' not found`);
        }

        item.reminderTime = new Date().toISOString();
        item.reminderCount = (item.reminderCount || 0) + 1;
        this.actionableItems.set(id, item);

        // Dispatch notification
        await automationEngine.sendNotification({
            target: item.assignee.name,
            recipientRole: item.assignee.role,
            title: `Reminder: Action Required - ${item.title}`,
            message: `Please take action on item '${item.title}'. Due at: ${item.dueTime}`
        }, { entityId: id });

        logger.info(`[NotificationActionCenter] Reminder dispatched for Action '${id}' to ${item.assignee.name}.`);
        this.syncToFirebase('actionable_work', id, item);
        return item;
    }

    /**
     * Trigger SLA Escalation
     */
    async triggerEscalation(id, { escalationAssignee, reason = 'SLA Threshold Approaching', actor = 'HR Escalator' }) {
        const item = this.actionableItems.get(id);
        if (!item) {
            throw new Error(`Actionable item '${id}' not found`);
        }

        item.status = 'escalated';
        item.severity = 'critical';
        item.urgency = 'critical';
        item.escalatedAt = new Date().toISOString();
        item.escalationReason = reason;

        if (escalationAssignee) {
            item.previousAssignee = { ...item.assignee };
            item.assignee = typeof escalationAssignee === 'object' 
                ? escalationAssignee 
                : { id: 'USR-ESC-LEAD', name: escalationAssignee, role: 'Senior Leadership' };
        }

        this.actionableItems.set(id, item);

        // Record Stage 8 escalation audit entry
        try {
            await automationEngine.recordAuditLog({
                runId: `esc-run-${id}`,
                automationId: `notification-escalation-${item.category}`,
                stage: 'Wait/Escalation',
                status: 'escalated',
                details: {
                    actionId: id,
                    title: item.title,
                    newAssignee: item.assignee,
                    reason,
                    actor
                }
            });
        } catch (e) {
            logger.warn(`[NotificationActionCenter] Audit log warning: ${e.message}`);
        }

        logger.info(`[NotificationActionCenter] Action '${id}' escalated to ${item.assignee.name}.`);
        this.syncToFirebase('actionable_work', id, item);
        return item;
    }

    /**
     * Mark Informational Notification as Read
     */
    markNoticeAsRead(id) {
        const notice = this.informationalNotices.get(id);
        if (!notice) {
            throw new Error(`Notice '${id}' not found`);
        }
        notice.isRead = true;
        this.informationalNotices.set(id, notice);
        this.syncToFirebase('informational_notices', id, notice);
        return notice;
    }

    /**
     * Mark All Informational Notifications as Read
     */
    markAllNoticesAsRead() {
        for (const notice of this.informationalNotices.values()) {
            notice.isRead = true;
            this.informationalNotices.set(notice.id, notice);
            this.syncToFirebase('informational_notices', notice.id, notice);
        }
        return { success: true, count: this.informationalNotices.size };
    }

    /**
     * Create Actionable Item
     */
    createActionableItem(data) {
        const id = data.id || `ACT-${Date.now()}`;
        const item = {
            id,
            title: data.title,
            description: data.description || '',
            type: 'actionable',
            category: data.category || 'general',
            severity: data.severity || 'medium',
            dueTime: data.dueTime || new Date(Date.now() + 86400000).toISOString(),
            reminderTime: data.reminderTime || new Date().toISOString(),
            escalationTime: data.escalationTime || new Date(Date.now() + 172800000).toISOString(),
            assignee: data.assignee || { id: 'USR-DEFAULT', name: 'HR Ops', role: 'hr_admin' },
            status: data.status || 'pending',
            urgency: data.urgency || 'due_this_week',
            module: data.module || 'General',
            actionOptions: data.actionOptions || ['approve', 'reject', 'resolve'],
            details: data.details || {}
        };
        this.actionableItems.set(id, item);
        return item;
    }

    /**
     * Create Informational Notice
     */
    createInformationalNotice(data) {
        const id = data.id || `NOTIF-${Date.now()}`;
        const notice = {
            id,
            title: data.title,
            message: data.message || '',
            category: data.category || 'general',
            timestamp: new Date().toISOString(),
            isRead: false,
            module: data.module || 'General',
            targetRole: data.targetRole || 'all'
        };
        this.informationalNotices.set(id, notice);
        return notice;
    }

    /**
     * Synchronize action or notice record to Firebase Firestore
     */
    async syncToFirebase(collectionName, docId, data) {
        try {
            if (db && typeof db.collection === 'function') {
                await db.collection(collectionName).doc(docId).set({
                    ...data,
                    syncedToFirebase: true,
                    firebaseProject: 'kylrxai',
                    lastSyncAt: new Date().toISOString()
                }, { merge: true });
            }
        } catch (err) {
            logger.warn(`[NotificationActionCenterService] Firebase sync warning for ${collectionName}/${docId}:`, err.message);
        }
    }

    /**
     * Synchronize zero state to Firebase Firestore (kylrxai)
     */
    async syncZeroStateToFirebase() {
        try {
            if (db && typeof db.collection === 'function') {
                await db.collection('enterprise_metrics').doc('notification_center').set({
                    totalActionable: 0,
                    totalInformational: 0,
                    unreadInformational: 0,
                    critical: 0,
                    dueToday: 0,
                    upcoming: 0,
                    approvals: 0,
                    attendance: 0,
                    payroll: 0,
                    pms: 0,
                    policy: 0,
                    exit: 0,
                    documents: 0,
                    system: 0,
                    connectedToFirebase: true,
                    firebaseProject: 'kylrxai',
                    status: 'all_zeroed',
                    syncedAt: new Date().toISOString()
                }, { merge: true });
            }
            logger.info('[NotificationActionCenterService] Zero state synchronized with Firebase Firestore kylrxai');
            return { success: true, connectedToFirebase: true, firebaseProject: 'kylrxai' };
        } catch (err) {
            logger.warn('[NotificationActionCenterService] Firebase syncZeroState fallback:', err.message);
            return { success: true, connectedToFirebase: false, fallback: true };
        }
    }
}

const service = new NotificationActionCenterService();
module.exports = service;
