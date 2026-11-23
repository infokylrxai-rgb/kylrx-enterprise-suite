const crypto = require('crypto');
const logger = require('../utils/logger');
const { db } = require('../config/firebase');

/**
 * AI-Assisted Builder Service (PRD §2.4)
 * 
 * Implements:
 * - 2.4 AI-Assisted Builder:
 *   • User describes the required alert (natural language prompt)
 *   • AI suggests triggers and conditions (eventKey, metric, comparator, threshold, evaluation window)
 *   • AI suggests recipients and message text (roles, channels, subject, body with template tokens)
 *   • The user can edit or reject suggestions (interactive customization or discarding)
 *   • The system validates the final setup (deterministic schema & rule gate)
 *   • An authorised user activates the configuration (strict role permission enforcement)
 *   • AI output must remain a draft. User approval is required before activation.
 */

class AiAssistedBuilderService {
    /**
     * @param {Object} [options]
     * @param {boolean} [options.sync=true] - Load the shared bulk_ai_configurations collection.
     *   Per-organization copies (routes/bulk-trigger.js) pass false and are loaded/saved by
     *   TenantEngineStore instead.
     */
    constructor(options = {}) {
        // In-Memory store for draft and active configurations
        // Key: configId -> Config Record
        this.configurations = new Map();

        // Audit Trail of all AI builder interactions
        this.auditTrail = [];

        // Authorized roles permitted to activate configurations
        this.authorizedActivationRoles = ['super_admin', 'admin', 'hr_admin', 'manager'];

        // Seed initial default presets for quick inspection
        this._seedCanonicalExamples();

        // Synchronize with Firebase Firestore
        this.sync = options.sync !== false;
        if (this.sync) this.initFirestoreSync().catch(() => {});
    }

    /**
     * Synchronize AI alert configurations with Firebase Firestore
     */
    async initFirestoreSync() {
        if (!db || typeof db.collection !== 'function') return;
        try {
            const snap = await db.collection('bulk_ai_configurations').limit(50).get().catch(() => null);
            if (snap && !snap.empty && Array.isArray(snap.docs)) {
                snap.docs.forEach(docSnap => {
                    const data = docSnap.data();
                    if (data && data.id) {
                        this.configurations.set(data.id, data);
                    }
                });
                logger.info(`[AiAssistedBuilder] Synchronized ${snap.docs.length} configurations live from Firebase Firestore.`);
            }
        } catch (e) {
            logger.warn(`[AiAssistedBuilder] Firestore sync notice: ${e.message}`);
        }
    }

    /**
     * Persist configuration to Firebase Firestore
     */
    async syncConfigToFirestore(config) {
        // Copies made with sync: false are saved by their owner (TenantEngineStore) or not at all
        if (!this.sync || !db || typeof db.collection !== 'function' || !config || !config.id) return;
        try {
            await db.collection('bulk_ai_configurations').doc(config.id).set({
                ...config,
                syncedAt: new Date().toISOString()
            }, { merge: true }).catch(() => {});
        } catch (e) {
            logger.warn(`[AiAssistedBuilder] Firestore syncConfig error: ${e.message}`);
        }
    }

    /**
     * Seed initial configurations illustrating PRD §2.4 requirements
     */
    _seedCanonicalExamples() {
        const sampleDraft = {
            id: 'ALERT-AI-SAMPLE-001',
            name: 'Attendance: 3 Consecutive Unexcused Absences Notification',
            description: 'AI-assisted alert draft for detecting unexcused absence streaks.',
            userPrompt: 'Alert reporting managers when an employee misses 3 consecutive unexcused days',
            module: 'attendance',
            category: 'Workforce Monitoring',
            severity: 'critical',
            status: 'draft',
            isDraft: true,
            activated: false,
            triggers: {
                eventKey: 'attendance.consecutive_absences_detected',
                displayName: 'Consecutive Absence Limit Exceeded',
                timeWindow: 'Rolling 5 Business Days'
            },
            conditions: {
                metric: 'Consecutive Unexcused Absences',
                comparator: '>=',
                thresholdValue: 3,
                unit: 'days'
            },
            recipients: [
                { role: 'Reporting Manager (L1)', target: 'manager', channelPreferences: ['email', 'in_app'] },
                { role: 'HR Operations', target: 'hr_ops', channelPreferences: ['in_app'] }
            ],
            message: {
                subject: 'CRITICAL ALERT: {{employeeName}} has {{consecutiveDays}} Consecutive Absences',
                body: 'Dear Manager, employee {{employeeName}} (ID: {{employeeId}}, Dept: {{department}}) has recorded {{consecutiveDays}} consecutive unexcused absences as of {{date}}. Immediate review and intervention required.',
                channels: ['email', 'in_app']
            },
            aiMetadata: {
                confidence: 0.94,
                reasoning: 'Matched workforce attendance rule. Suggested L1 manager and HR notification with high priority.',
                generatedAt: new Date(Date.now() - 3600000).toISOString(),
                draftSafetyNotice: 'AI recommendations strictly remain in draft state. Manual review and authorized user approval required prior to activation.'
            },
            validationStatus: {
                isValid: true,
                errors: [],
                warnings: [],
                validatedAt: new Date(Date.now() - 3600000).toISOString()
            },
            history: [
                { action: 'AI_DRAFT_GENERATED', timestamp: new Date(Date.now() - 3600000).toISOString(), actor: 'AI_ASSISTANT' }
            ],
            createdAt: new Date(Date.now() - 3600000).toISOString(),
            updatedAt: new Date(Date.now() - 3600000).toISOString()
        };

        this.configurations.set(sampleDraft.id, sampleDraft);
    }

    /**
     * Compute SHA-256 hash
     */
    computeHash(data) {
        return crypto.createHash('sha256').update(typeof data === 'string' ? data : JSON.stringify(data)).digest('hex');
    }

    /* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
       1. GENERATE AI SUGGESTIONS (PRD §2.4: User describes, AI suggests)
    ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */

    /**
     * Generate structured draft alert from user natural language prompt
     * @param {string} prompt - User description of required alert
     * @param {object} context - Optional departmental / module context
     * @param {object} actor - Initiator requesting AI recommendation
     * @returns {object} Draft configuration strictly in draft state
     */
    generateAlertDraft(prompt, context = {}, actor = {}) {
        if (!prompt || typeof prompt !== 'string' || prompt.trim().length === 0) {
            throw new Error('User alert description is required to generate AI recommendations.');
        }

        const normalized = prompt.toLowerCase().trim();
        const synthesized = this._synthesizeAlertFromPrompt(normalized, prompt, context);

        const draftId = `ALERT-DRAFT-${Date.now()}-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;
        const now = new Date().toISOString();

        // PRD §2.4 Core Constraint: "AI output must remain a draft. User approval is required before activation."
        const draftConfig = {
            id: draftId,
            name: synthesized.name,
            description: synthesized.description,
            userPrompt: prompt,
            module: synthesized.module,
            category: synthesized.category,
            severity: synthesized.severity,
            
            // STRICT DRAFT ENFORCEMENT
            status: 'draft',
            isDraft: true,
            activated: false,
            canAutoActivate: false, // Guard against any automated activation bypass

            triggers: synthesized.triggers,
            conditions: synthesized.conditions,
            recipients: synthesized.recipients,
            message: synthesized.message,
            
            aiMetadata: {
                confidence: synthesized.confidence,
                reasoning: synthesized.reasoning,
                suggestedTokens: synthesized.tokens,
                generatedAt: now,
                promptReceived: prompt,
                draftSafetyNotice: 'AI recommendations strictly remain in draft state. Manual review and authorized user approval required prior to activation.'
            },

            validationStatus: this.validateConfiguration({
                name: synthesized.name,
                triggers: synthesized.triggers,
                conditions: synthesized.conditions,
                recipients: synthesized.recipients,
                message: synthesized.message
            }),

            history: [
                {
                    action: 'AI_DRAFT_GENERATED',
                    actor: actor.name || actor.id || 'User',
                    actorRole: actor.role || 'user',
                    timestamp: now,
                    details: 'AI suggested triggers, conditions, recipients and message templates.'
                }
            ],

            createdAt: now,
            updatedAt: now
        };

        // Persist to store
        this.configurations.set(draftId, draftConfig);
        this.syncConfigToFirestore(draftConfig).catch(() => {});

        this._logAudit({
            action: 'AI_ALERT_DRAFT_CREATED',
            configId: draftId,
            initiator: actor,
            details: `Draft created for prompt: "${prompt.substring(0, 60)}..."`,
            status: 'draft'
        });

        logger.info(`[AiAssistedBuilder] Generated draft ${draftId} from prompt. Status: DRAFT.`);

        return draftConfig;
    }

    /**
     * Internal semantic parser for alert synthesis
     */
    _synthesizeAlertFromPrompt(normalized, rawPrompt, context = {}) {
        // 1. Attendance & Absence Detection
        if (normalized.includes('absent') || normalized.includes('absence') || normalized.includes('leave') || normalized.includes('attendance') || normalized.includes('miss') || normalized.includes('unexcused')) {
            const daysMatch = normalized.match(/(\d+)\s*(?:consecutive\s*)?(?:day|business day|unexcused)/i) || normalized.match(/(\d+)/);
            const days = daysMatch ? parseInt(daysMatch[1], 10) : 3;

            return {
                name: `Attendance: ${days} Consecutive Absences Alert`,
                description: `Flags employees recording ${days} or more consecutive unexcused absences and notifies management.`,
                module: 'attendance',
                category: 'Workforce Monitoring',
                severity: days >= 3 ? 'critical' : 'warning',
                confidence: 0.95,
                reasoning: `Identified attendance anomaly rule with threshold of ${days} consecutive days. Recommended reporting manager & HRBP routing.`,
                triggers: {
                    eventKey: 'attendance.consecutive_absences_detected',
                    displayName: 'Consecutive Absence Limit Exceeded',
                    timeWindow: 'Rolling 5 Business Days'
                },
                conditions: {
                    metric: 'Consecutive Unexcused Absences',
                    comparator: '>=',
                    thresholdValue: days,
                    unit: 'days'
                },
                recipients: [
                    { role: 'Reporting Manager (L1)', target: 'manager', channelPreferences: ['email', 'in_app'] },
                    { role: 'HR Operations', target: 'hr_ops', channelPreferences: ['in_app'] }
                ],
                message: {
                    subject: `URGENT: {{employeeName}} - ${days} Consecutive Absences Detected`,
                    body: `Dear Manager, employee {{employeeName}} (ID: {{employeeId}}, Dept: {{department}}) has marked {{consecutiveDays}} consecutive unexcused absences. Please verify shift roster and initiate communication.`,
                    channels: ['email', 'in_app']
                },
                tokens: ['{{employeeName}}', '{{employeeId}}', '{{department}}', '{{consecutiveDays}}', '{{date}}']
            };
        }

        // 2. Payroll & Variance Detection
        if (normalized.includes('payroll') || normalized.includes('salary') || normalized.includes('variance') || normalized.includes('disbursement') || normalized.includes('payout')) {
            const percentMatch = normalized.match(/(\d+)\s*%/i) || normalized.match(/(\d+)\s*percent/i);
            const variance = percentMatch ? parseInt(percentMatch[1], 10) : 10;

            return {
                name: `Payroll: Month-Over-Month Variance > ${variance}% Alert`,
                description: `Automated safety guard triggered when gross disbursement calculation varies by more than ${variance}%.`,
                module: 'payroll',
                category: 'Financial Safety',
                severity: 'critical',
                confidence: 0.93,
                reasoning: `Detected financial variance rule with ${variance}% variance threshold. Recommended immediate freeze notice to Payroll Admin.`,
                triggers: {
                    eventKey: 'payroll.variance_calculated',
                    displayName: 'Gross Payroll Variance Limit Exceeded',
                    timeWindow: 'Pre-Disbursement Audit Cycle'
                },
                conditions: {
                    metric: 'Gross Payroll Variance %',
                    comparator: '>',
                    thresholdValue: variance,
                    unit: 'percent'
                },
                recipients: [
                    { role: 'Payroll Admin', target: 'payroll_admin', channelPreferences: ['email', 'in_app'] },
                    { role: 'Chief Financial Officer', target: 'cfo', channelPreferences: ['email'] }
                ],
                message: {
                    subject: `CRITICAL: Payroll Variance Alert (${variance}% Threshold Breached)`,
                    body: `Attention Payroll Operations: Batch {{batchId}} shows a month-over-month variance of {{variancePercent}}%, exceeding the authorized ${variance}% safety margin. Payroll release is held pending manual review.`,
                    channels: ['email', 'in_app']
                },
                tokens: ['{{batchId}}', '{{variancePercent}}', '{{previousMonthGross}}', '{{currentMonthGross}}', '{{runDate}}']
            };
        }

        // 3. Policy Compliance & Acknowledgement
        if (normalized.includes('policy') || normalized.includes('compliance') || normalized.includes('acknowledge') || normalized.includes('handbook')) {
            const daysMatch = normalized.match(/(\d+)\s*day/i);
            const days = daysMatch ? parseInt(daysMatch[1], 10) : 3;

            return {
                name: `Policy: Acknowledgement Pending > ${days} Days Reminder`,
                description: `Dispatches progressive compliance reminders when mandatory company policies remain unacknowledged.`,
                module: 'policies',
                category: 'Compliance Tracking',
                severity: 'warning',
                confidence: 0.91,
                reasoning: `Identified statutory policy acknowledgement requirement. Suggested employee reminder with manager cc after ${days} days.`,
                triggers: {
                    eventKey: 'policy.acknowledgement_pending',
                    displayName: 'Mandatory Policy Acknowledgement Overdue',
                    timeWindow: `Past ${days} Calendar Days`
                },
                conditions: {
                    metric: 'Pending Duration (Days)',
                    comparator: '>=',
                    thresholdValue: days,
                    unit: 'days'
                },
                recipients: [
                    { role: 'Employee', target: 'employee', channelPreferences: ['email', 'in_app'] },
                    { role: 'Reporting Manager', target: 'manager', channelPreferences: ['in_app'] }
                ],
                message: {
                    subject: `Action Required: Mandatory Policy Acknowledgement Pending ({{policyName}})`,
                    body: `Hello {{employeeName}}, the mandatory corporate policy '{{policyName}}' has been pending your formal digital signature for ${days} days. Please log in to complete your acknowledgement today.`,
                    channels: ['email', 'in_app']
                },
                tokens: ['{{employeeName}}', '{{policyName}}', '{{publishedDate}}', '{{pendingDays}}', '{{link}}']
            };
        }

        // 4. Performance & Appraisal Deadlines
        if (normalized.includes('pms') || normalized.includes('appraisal') || normalized.includes('performance') || normalized.includes('review') || normalized.includes('kpi') || normalized.includes('goal')) {
            const daysMatch = normalized.match(/(\d+)\s*day/i);
            const days = daysMatch ? parseInt(daysMatch[1], 10) : 2;

            return {
                name: `PMS: Review Deadline Approaching (${days} Days Remaining)`,
                description: `Alerts managers and review leads as performance cycle cut-off dates approach.`,
                module: 'pms',
                category: 'Performance Management',
                severity: 'warning',
                confidence: 0.90,
                reasoning: `Identified performance management cycle cutoff alert. Suggested manager reminders and HRBP escalation.`,
                triggers: {
                    eventKey: 'pms.review_deadline_approaching',
                    displayName: 'Performance Cycle Cut-off Approaching',
                    timeWindow: `Upcoming ${days} Days`
                },
                conditions: {
                    metric: 'Days Remaining Until Cut-off',
                    comparator: '<=',
                    thresholdValue: days,
                    unit: 'days'
                },
                recipients: [
                    { role: 'Reporting Manager', target: 'manager', channelPreferences: ['email', 'in_app'] },
                    { role: 'HRBP Lead', target: 'hrbp', channelPreferences: ['in_app'] }
                ],
                message: {
                    subject: `Reminder: Performance Reviews Due in ${days} Days ({{cycleName}})`,
                    body: `Dear Manager, you have {{pendingCount}} performance appraisals pending completion for cycle '{{cycleName}}'. Review cycle locks on {{deadlineDate}}.`,
                    channels: ['email', 'in_app']
                },
                tokens: ['{{managerName}}', '{{cycleName}}', '{{pendingCount}}', '{{deadlineDate}}']
            };
        }

        // 5. Security & Inactivity Monitoring
        if (normalized.includes('security') || normalized.includes('inactive') || normalized.includes('idle') || normalized.includes('dormant') || normalized.includes('session')) {
            const daysMatch = normalized.match(/(\d+)\s*day/i);
            const days = daysMatch ? parseInt(daysMatch[1], 10) : 30;

            return {
                name: `Security: Inactivity > ${days} Days Account Suspension Alert`,
                description: `Flags inactive or dormant user profiles for credential quarantine.`,
                module: 'security',
                category: 'Information Security',
                severity: 'critical',
                confidence: 0.92,
                reasoning: `Identified dormant account security posture requirement. Alert routed to IT Security and HR Operations.`,
                triggers: {
                    eventKey: 'security.inactivity_detected',
                    displayName: 'Prolonged Account Inactivity',
                    timeWindow: `Rolling ${days} Days`
                },
                conditions: {
                    metric: 'Inactive Duration (Days)',
                    comparator: '>=',
                    thresholdValue: days,
                    unit: 'days'
                },
                recipients: [
                    { role: 'IT Security Administrator', target: 'it_security', channelPreferences: ['email', 'in_app'] },
                    { role: 'HR Operations', target: 'hr_ops', channelPreferences: ['in_app'] }
                ],
                message: {
                    subject: `SECURITY NOTICE: Dormant User Account Detected ({{userName}})`,
                    body: `Account for user {{userName}} ({{userEmail}}) has had zero authentication activity for ${days} days. Automated credential lockout will be initiated in 48 hours unless active status is re-verified.`,
                    channels: ['email', 'in_app']
                },
                tokens: ['{{userName}}', '{{userEmail}}', '{{department}}', '{{lastLoginDate}}', '{{inactiveDays}}']
            };
        }

        // Default Generic Synthesizer
        return {
            name: `Alert: ${rawPrompt.substring(0, 40)}`,
            description: `Automated alert configuration generated from description: "${rawPrompt}".`,
            module: context.module || 'custom',
            category: 'Enterprise Automation',
            severity: 'warning',
            confidence: 0.85,
            reasoning: 'Synthesized custom alert based on prompt keywords. Recommended standard management notification.',
            triggers: {
                eventKey: 'custom.event_condition_matched',
                displayName: 'Custom Event Condition Matched',
                timeWindow: 'Real-time Event Stream'
            },
            conditions: {
                metric: 'Occurrence Count',
                comparator: '>=',
                thresholdValue: 1,
                unit: 'events'
            },
            recipients: [
                { role: 'Operations Admin', target: 'admin', channelPreferences: ['in_app', 'email'] }
            ],
            message: {
                subject: `Alert Notification: {{eventName}}`,
                body: `System alert triggered for {{eventName}} at {{timestamp}}. Context details: {{details}}.`,
                channels: ['in_app', 'email']
            },
            tokens: ['{{eventName}}', '{{timestamp}}', '{{details}}']
        };
    }

    /* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
       2. USER EDIT & REJECT (PRD §2.4: User can edit or reject suggestions)
    ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */

    /**
     * User edits AI suggestions before activation
     * @param {string} draftId - Identifier of the draft
     * @param {object} edits - Updated fields (name, triggers, conditions, recipients, message, etc.)
     * @param {object} actor - User making the modifications
     * @returns {object} Updated draft configuration
     */
    updateDraft(draftId, edits = {}, actor = {}) {
        const draft = this.configurations.get(draftId);
        if (!draft) {
            throw new Error(`Configuration draft '${draftId}' not found.`);
        }

        if (draft.status !== 'draft') {
            throw new Error(`Cannot modify configuration '${draftId}' because it is in '${draft.status}' status (must be 'draft').`);
        }

        const now = new Date().toISOString();

        // Apply edits safely
        if (edits.name) draft.name = edits.name.trim();
        if (edits.description !== undefined) draft.description = edits.description;
        if (edits.severity) draft.severity = edits.severity;

        if (edits.triggers) {
            draft.triggers = { ...draft.triggers, ...edits.triggers };
        }
        if (edits.conditions) {
            draft.conditions = { ...draft.conditions, ...edits.conditions };
        }
        if (edits.recipients) {
            draft.recipients = Array.isArray(edits.recipients) ? edits.recipients : draft.recipients;
        }
        if (edits.message) {
            draft.message = { ...draft.message, ...edits.message };
        }

        // Mark as user-modified
        draft.userModified = true;
        draft.updatedAt = now;

        // Re-validate final setup
        draft.validationStatus = this.validateConfiguration({
            name: draft.name,
            triggers: draft.triggers,
            conditions: draft.conditions,
            recipients: draft.recipients,
            message: draft.message
        });

        draft.history.push({
            action: 'USER_EDITED_SUGGESTION',
            actor: actor.name || actor.id || 'User',
            actorRole: actor.role || 'user',
            timestamp: now,
            details: 'User modified AI suggestions (customized triggers, conditions, or messaging).'
        });

        this.configurations.set(draftId, draft);
        this.syncConfigToFirestore(draft).catch(() => {});

        this._logAudit({
            action: 'AI_ALERT_DRAFT_MODIFIED',
            configId: draftId,
            initiator: actor,
            details: 'User edited AI recommendations',
            status: 'draft'
        });

        logger.info(`[AiAssistedBuilder] Draft ${draftId} updated by user. Valid: ${draft.validationStatus.isValid}`);

        return draft;
    }

    /**
     * User rejects AI recommendation
     * @param {string} draftId - Identifier of draft
     * @param {string} rejectionReason - Optional user explanation
     * @param {object} actor - User rejecting suggestion
     * @returns {object} Rejected configuration
     */
    rejectDraft(draftId, rejectionReason = 'Rejected by user', actor = {}) {
        const draft = this.configurations.get(draftId);
        if (!draft) {
            throw new Error(`Configuration draft '${draftId}' not found.`);
        }

        const now = new Date().toISOString();
        draft.status = 'rejected';
        draft.isDraft = false;
        draft.activated = false;
        draft.rejectionReason = rejectionReason;
        draft.rejectedAt = now;
        draft.rejectedBy = {
            id: actor.id || 'USER-01',
            name: actor.name || 'User',
            role: actor.role || 'user'
        };

        draft.history.push({
            action: 'USER_REJECTED_SUGGESTION',
            actor: actor.name || actor.id || 'User',
            actorRole: actor.role || 'user',
            timestamp: now,
            details: `Suggestion rejected. Reason: ${rejectionReason}`
        });

        this.configurations.set(draftId, draft);
        this.syncConfigToFirestore(draft).catch(() => {});

        this._logAudit({
            action: 'AI_ALERT_DRAFT_REJECTED',
            configId: draftId,
            initiator: actor,
            details: `Suggestion rejected: ${rejectionReason}`,
            status: 'rejected'
        });

        logger.info(`[AiAssistedBuilder] Draft ${draftId} rejected by user. Reason: ${rejectionReason}`);

        return draft;
    }

    /* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
       3. SYSTEM VALIDATION (PRD §2.4: The system validates the final setup)
    ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */

    /**
     * Deterministic schema and rule gate validating configuration before activation
     * @param {object} config - Configuration object to validate
     * @returns {object} { isValid: boolean, errors: string[], warnings: string[] }
     */
    validateConfiguration(config = {}) {
        const errors = [];
        const warnings = [];

        // 1. Basic Identity
        if (!config.name || typeof config.name !== 'string' || config.name.trim().length === 0) {
            errors.push('Configuration Name is required and cannot be empty.');
        }

        // 2. Triggers Validation
        const triggers = config.triggers || {};
        if (!triggers.eventKey || typeof triggers.eventKey !== 'string' || triggers.eventKey.trim().length === 0) {
            errors.push('Trigger Event Key is mandatory (e.g. attendance.consecutive_absences_detected).');
        }

        // 3. Conditions Validation
        const conditions = config.conditions || {};
        if (!conditions.metric || typeof conditions.metric !== 'string') {
            errors.push('Evaluation Metric is required (e.g. Consecutive Absences, Gross Variance %).');
        }

        const validComparators = ['>', '<', '>=', '<=', '==', '!='];
        if (!conditions.comparator || !validComparators.includes(conditions.comparator)) {
            errors.push(`Invalid Comparator '${conditions.comparator}'. Must be one of: ${validComparators.join(', ')}.`);
        }

        if (conditions.thresholdValue === undefined || conditions.thresholdValue === null || isNaN(Number(conditions.thresholdValue))) {
            errors.push('Threshold Value must be a valid numeric quantity.');
        }

        // 4. Recipients Validation
        const recipients = config.recipients || [];
        if (!Array.isArray(recipients) || recipients.length === 0) {
            errors.push('At least one recipient role or entity must be designated.');
        } else {
            const hasValidRecipient = recipients.some(r => r && (r.role || r.target || r.email || r.id));
            if (!hasValidRecipient) {
                errors.push('Recipients list contains invalid or empty recipient definitions.');
            }
        }

        // 5. Message & Channels Validation
        const message = config.message || {};
        if (!message.subject || typeof message.subject !== 'string' || message.subject.trim().length === 0) {
            errors.push('Message Subject line is required.');
        }
        if (!message.body || typeof message.body !== 'string' || message.body.trim().length === 0) {
            errors.push('Message Body content is required.');
        }

        const channels = message.channels || [];
        if (!Array.isArray(channels) || channels.length === 0) {
            warnings.push('No dispatch channel selected; defaults to in_app notification.');
        }

        return {
            isValid: errors.length === 0,
            errors,
            warnings,
            validatedAt: new Date().toISOString()
        };
    }

    /* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
       4. AUTHORISED ACTIVATION (PRD §2.4: An authorised user activates the configuration)
    ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */

    /**
     * An authorised user reviews, approves, and activates the configuration
     * @param {string} draftId - Identifier of draft configuration
     * @param {object} actor - User attempting activation
     * @returns {object} Activated configuration
     */
    activateConfiguration(draftId, actor = {}) {
        const draft = this.configurations.get(draftId);
        if (!draft) {
            throw new Error(`Configuration draft '${draftId}' not found.`);
        }

        if (draft.status === 'active') {
            throw new Error(`Configuration '${draftId}' is already active.`);
        }

        if (draft.status === 'rejected') {
            throw new Error(`Cannot activate configuration '${draftId}' because it was previously rejected. Please generate a new draft.`);
        }

        // Role Authorization Guard
        const role = (actor.role || '').toLowerCase();
        if (!this.authorizedActivationRoles.includes(role)) {
            throw new Error(`Permission Denied: Role '${role || 'unassigned'}' is not authorised to activate alerts. Only [${this.authorizedActivationRoles.join(', ')}] can activate.`);
        }

        // Pre-Activation System Validation Gate
        const validation = this.validateConfiguration({
            name: draft.name,
            triggers: draft.triggers,
            conditions: draft.conditions,
            recipients: draft.recipients,
            message: draft.message
        });

        if (!validation.isValid) {
            throw new Error(`Activation Blocked: Configuration failed system validation. Errors: ${validation.errors.join('; ')}`);
        }

        const now = new Date().toISOString();

        // Formal status transition from 'draft' -> 'active'
        draft.status = 'active';
        draft.isDraft = false;
        draft.activated = true;
        draft.activatedAt = now;
        draft.activatedBy = {
            id: actor.id || 'ADM-AUTH-01',
            name: actor.name || 'Authorised Administrator',
            role: role
        };
        draft.validationStatus = validation;
        draft.updatedAt = now;

        draft.history.push({
            action: 'CONFIGURATION_ACTIVATED',
            actor: actor.name || actor.id || 'Admin',
            actorRole: role,
            timestamp: now,
            details: `Approved and formally activated by authorized user (${actor.name || actor.id}, Role: ${role}).`
        });

        this.configurations.set(draftId, draft);
        this.syncConfigToFirestore(draft).catch(() => {});

        // Immutable Audit Log entry
        this._logAudit({
            action: 'AI_ALERT_CONFIGURATION_ACTIVATED',
            configId: draftId,
            initiator: actor,
            details: `Alert '${draft.name}' activated into live production monitoring.`,
            status: 'active'
        });

        logger.info(`[AiAssistedBuilder] Draft ${draftId} successfully ACTIVATED by ${actor.name} (${role}). Status: ACTIVE.`);

        return draft;
    }

    /* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
       5. QUERY & AUDIT INSPECTION
    ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */

    /**
     * Get list of all configurations
     */
    getAllConfigurations(filter = {}) {
        let list = Array.from(this.configurations.values());

        if (filter.status) {
            list = list.filter(c => c.status === filter.status);
        }
        if (filter.module) {
            list = list.filter(c => c.module === filter.module);
        }
        if (filter.severity) {
            list = list.filter(c => c.severity === filter.severity);
        }

        return list.sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));
    }

    /**
     * Get individual configuration by ID
     */
    getConfigurationById(id) {
        return this.configurations.get(id) || null;
    }

    /**
     * Get Audit Trail logs
     */
    getAuditTrail(limit = 50) {
        return this.auditTrail.slice(-limit).reverse();
    }

    /**
     * Internal audit logger
     */
    _logAudit(entry) {
        const auditRecord = {
            id: `AUD-AI-${Date.now()}-${crypto.randomBytes(2).toString('hex').toUpperCase()}`,
            timestamp: new Date().toISOString(),
            action: entry.action,
            configId: entry.configId,
            initiator: {
                id: entry.initiator?.id || 'SYSTEM',
                name: entry.initiator?.name || 'Authorized Actor',
                role: entry.initiator?.role || 'admin'
            },
            status: entry.status,
            details: entry.details,
            integrityHash: this.computeHash(entry)
        };

        this.auditTrail.push(auditRecord);
    }
}

// Export singleton instance
module.exports = new AiAssistedBuilderService();
