const { db } = require('../config/firebase');
const eventBus = require('./event-bus');
const logger = require('../utils/logger');
const crypto = require('crypto');

class AutomationEngine {
    constructor() {
        this.isInitialized = false;
    }

    /**
     * Start the engine and bind to the central event bus
     */
    start() {
        if (this.isInitialized) return;

        logger.info('[AutomationEngine] Starting up and binding to EventBus...');
        
        // Listen to the catch-all event and process rules
        eventBus.on('*', async (eventData) => {
            try {
                await this.processEvent(eventData);
            } catch (error) {
                logger.error(`[AutomationEngine] Error processing event ${eventData.eventId}:`, error);
            }
        });

        this.isInitialized = true;
    }

    /**
     * Process an incoming event against active automation rules
     * @param {Object} eventData 
     */
    async processEvent(eventData) {
        const { eventName } = eventData;
        logger.info(`[AutomationEngine] Processing event ${eventName}...`);

        // Query active automations for this event
        let automationsSnapshot;
        try {
            automationsSnapshot = await db.collection('automations')
                .where('trigger_event', '==', eventName)
                .where('status', '==', 'active')
                .get();
        } catch (error) {
            logger.error('[AutomationEngine] Failed to query automations. Note: A composite index might be required.', error);
            return;
        }

        if (automationsSnapshot.empty) {
            logger.info(`[AutomationEngine] No active automations found for event: ${eventName}`);
            return;
        }

        const automations = automationsSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));

        // Evaluate each automation rule
        for (const rule of automations) {
            await this.executeRule(rule, eventData);
        }
    }

    /**
     * Execute a specific rule if its conditions match
     */
    async executeRule(rule, eventData) {
        logger.info(`[AutomationEngine] Evaluating rule: ${rule.name || rule.id}`);

        const isMatch = this.evaluateCondition(rule.conditions, eventData.payload);
        
        if (!isMatch) {
            logger.info(`[AutomationEngine] Rule conditions not met for: ${rule.id}`);
            return;
        }

        // Rule matched, start execution pipeline
        const runId = crypto.randomUUID();
        logger.info(`[AutomationEngine] Starting execution run ${runId} for rule ${rule.id}`);

        const runDocRef = db.collection('automation_runs').doc(runId);
        
        await runDocRef.set({
            run_id: runId,
            automation_id: rule.id,
            event_id: eventData.eventId,
            event_name: eventData.eventName,
            entity_id: eventData.entityId,
            status: 'in_progress',
            started_at: new Date().toISOString(),
            current_step: 0,
            payload_snapshot: eventData.payload,
            logs: []
        });

        await this.logRunStep(runId, 'Rule Matched', { conditions: rule.conditions });

        await this.processNextStep(rule, 0, runId, eventData);
    }

    /**
     * Recursively process pipeline steps
     */
    async processNextStep(rule, stepIndex, runId, eventData) {
        const pipeline = rule.pipeline || [];
        
        if (stepIndex >= pipeline.length) {
            // Pipeline complete
            await db.collection('automation_runs').doc(runId).update({
                status: 'completed',
                completed_at: new Date().toISOString()
            });
            await this.logRunStep(runId, 'Pipeline Completed', {});
            logger.info(`[AutomationEngine] Run ${runId} completed.`);
            return;
        }

        const step = pipeline[stepIndex];
        logger.info(`[AutomationEngine] Run ${runId} executing step ${stepIndex}: ${step.type}`);
        
        await db.collection('automation_runs').doc(runId).update({
            current_step: stepIndex
        });

        try {
            switch (step.type) {
                case 'approval':
                case 'task':
                    await this.createTask(step, runId, eventData, rule.id || rule.name);
                    // Pause execution until task is resolved via API
                    await db.collection('automation_runs').doc(runId).update({
                        status: 'waiting_on_task'
                    });
                    await this.logRunStep(runId, 'Paused for Task/Approval', { task_config: step });
                    return; // Stop pipeline loop here
                
                case 'notification':
                    await this.sendNotification(step, eventData);
                    await this.logRunStep(runId, 'Notification Sent', { target: step.target });
                    break;
                
                case 'action':
                    await this.executeAction(step, eventData);
                    await this.logRunStep(runId, 'Action Executed', { action: step.action });
                    break;

                default:
                    logger.warn(`[AutomationEngine] Unknown step type: ${step.type}`);
            }

            // Proceed to next step immediately if it's synchronous
            await this.processNextStep(rule, stepIndex + 1, runId, eventData);

        } catch (error) {
            logger.error(`[AutomationEngine] Run ${runId} failed at step ${stepIndex}:`, error);
            await db.collection('automation_runs').doc(runId).update({
                status: 'failed',
                error_message: error.message,
                failed_at: new Date().toISOString()
            });
            await this.logRunStep(runId, 'Step Failed', { error: error.message });
        }
    }

    /**
     * Create a task/approval item in Firestore
     */
    async createTask(stepConfig, runId, eventData, ruleId = null) {
        const taskId = crypto.randomUUID();
        const escalationMetadata = {};
        
        if (stepConfig.escalation_hours) {
            const escalationAt = new Date();
            escalationAt.setHours(escalationAt.getHours() + stepConfig.escalation_hours);
            escalationMetadata.escalation_at = escalationAt.toISOString();
            escalationMetadata.escalation_assignee = stepConfig.escalation_assignee || 'admin';
        }

        await db.collection('tasks').doc(taskId).set({
            task_id: taskId,
            run_id: runId,
            automation_id: stepConfig.automation_id || ruleId || 'unknown',
            assignee_role: stepConfig.assignee_role || null,
            assignee_id: stepConfig.assignee_id || null,
            entity_id: eventData.entityId || null,
            title: stepConfig.title || 'Pending Task',
            description: stepConfig.description || '',
            status: 'pending',
            created_at: new Date().toISOString(),
            due_at: stepConfig.due_at || null,
            payload: eventData.payload || {},
            ...escalationMetadata
        });

        logger.info(`[AutomationEngine] Task ${taskId} created for Run ${runId}`);
    }

    /**
     * Mock Notification sender
     */
    async sendNotification(stepConfig, eventData) {
        // Implement real notification logic using your messaging-engine or FCM
        logger.info(`[AutomationEngine] 📩 Sending Notification to ${stepConfig.target}: ${stepConfig.message}`);
    }

    /**
     * Execute generic action (e.g., updating user status, calling external webhook)
     */
    async executeAction(stepConfig, eventData) {
        logger.info(`[AutomationEngine] ⚙️ Executing Action: ${stepConfig.action}`);
        if (stepConfig.action === 'update_firestore') {
            const { collection, documentId, updates } = stepConfig.params;
            const docRef = db.collection(collection).doc(documentId === '{entityId}' ? eventData.entityId : documentId);
            await docRef.update(updates);
        }
    }

    /**
     * Append a log to the automation run
     */
    async logRunStep(runId, message, meta = {}) {
        const logEntry = {
            message,
            meta,
            timestamp: new Date().toISOString()
        };
        const admin = require('firebase-admin');
        await db.collection('automation_runs').doc(runId).update({
            logs: admin.firestore.FieldValue.arrayUnion(logEntry)
        });
    }

    /**
     * Resume a paused pipeline (called when a task is resolved)
     */
    async resumePipeline(runId, actionData) {
        logger.info(`[AutomationEngine] Resuming Run ${runId}...`);
        
        const runDoc = await db.collection('automation_runs').doc(runId).get();
        if (!runDoc.exists) throw new Error('Automation run not found');
        
        const runData = runDoc.data();
        if (runData.status !== 'waiting_on_task') {
            throw new Error('Run is not waiting on a task');
        }

        await this.logRunStep(runId, 'Task Resolved', actionData);

        const ruleDoc = await db.collection('automations').doc(runData.automation_id).get();
        if (!ruleDoc.exists) throw new Error('Original automation rule not found');

        await db.collection('automation_runs').doc(runId).update({
            status: 'in_progress'
        });

        // Resume from the next step
        await this.processNextStep(ruleDoc.data(), runData.current_step + 1, runId, {
            eventId: runData.event_id,
            eventName: runData.event_name,
            entityId: runData.entity_id,
            payload: runData.payload_snapshot
        });
    }

    /**
     * Dynamic condition evaluator
     * Supports: ==, !=, >, <, >=, <=, in, contains, and composite AND/OR
     */
    evaluateCondition(conditionBlock, payload) {
        if (!conditionBlock || Object.keys(conditionBlock).length === 0) return true; // No conditions = Match all

        if (conditionBlock.operator === 'AND') {
            return conditionBlock.rules.every(rule => this.evaluateCondition(rule, payload));
        }

        if (conditionBlock.operator === 'OR') {
            return conditionBlock.rules.some(rule => this.evaluateCondition(rule, payload));
        }

        // Single condition evaluation
        const { field, op, value } = conditionBlock;
        if (!field || !op) return false;

        const payloadValue = this.resolveFieldPath(payload, field);

        switch (op) {
            case '==': return payloadValue === value;
            case '!=': return payloadValue !== value;
            case '>': return payloadValue > value;
            case '>=': return payloadValue >= value;
            case '<': return payloadValue < value;
            case '<=': return payloadValue <= value;
            case 'in': return Array.isArray(value) && value.includes(payloadValue);
            case 'contains': return Array.isArray(payloadValue) && payloadValue.includes(value);
            default: return false;
        }
    }

    /**
     * Resolves nested field paths (e.g. 'user.department.id')
     */
    resolveFieldPath(obj, path) {
        return path.split('.').reduce((o, i) => (o ? o[i] : undefined), obj);
    }
}

const engine = new AutomationEngine();
module.exports = engine;
