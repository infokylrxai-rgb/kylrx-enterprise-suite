/**
 * Alert Trigger Registry & Safe AI Simulation Engine (PRD Section 11)
 * 
 * Manages the enterprise trigger registry schema and executes sandboxed
 * dry-run simulations without writing to Firestore, mutating employee records,
 * dispatching emails/SMS, or executing external webhooks.
 */

const logger = require('../utils/logger');

// Enterprise Trigger Registry Schema strictly adhering to PRD §11
const CANONICAL_TRIGGER_REGISTRY = [
    {
        eventKey: 'EVT_ABSENCE_EXCEEDED',
        displayName: 'Consecutive Absence Limit Exceeded',
        description: 'Fires automatically when an employee marks unexcused absence for 3 or more consecutive business days, routing an immediate alert to L1 and L2 managers.',
        category: 'Attendance & Leave',
        module: 'attendance',
        severity: 'critical',
        parameters: ['employeeId', 'employeeName', 'consecutiveDays', 'reportingManagerId', 'department'],
        metric: 'Consecutive Unexcused Absences',
        comparator: '>=',
        thresholdValue: 3,
        timeWindow: 'Rolling 5 Business Days',
        sampleMockPayload: {
            employeeId: 'EMP0102',
            employeeName: 'Rahul Sharma',
            consecutiveDays: 4,
            reportingManagerId: 'MGR004',
            department: 'Core Engineering'
        },
        sampleDenialPayload: {
            employeeId: 'EMP0102',
            employeeName: 'Rahul Sharma',
            consecutiveDays: 2,
            reportingManagerId: 'MGR004',
            department: 'Core Engineering'
        },
        routing: {
            primaryRecipients: ['Reporting Manager (L1)', 'Secondary Manager (L2)'],
            channels: ['in_app', 'email', 'sms'],
            escalationTarget: 'HRBP Lead',
            escalationTimeoutHours: 24,
            webhookEnabled: true,
            webhookEndpointTemplate: 'https://hooks.slack.com/services/T00/B00/attendance-anomalies'
        }
    },
    {
        eventKey: 'EVT_PROBATION_EXPIRY',
        displayName: 'Probation Period Expiry Review',
        description: 'Triggers a mandatory confirmation review notification 14 calendar days prior to an employee probation end-date, routing performance sign-off tasks to management.',
        category: 'Workforce Lifecycle',
        module: 'onboarding',
        severity: 'warning',
        parameters: ['employeeId', 'employeeName', 'daysUntilProbationEnd', 'reportingManagerId', 'probationEndDate'],
        metric: 'Days Until Probation End',
        comparator: '<=',
        thresholdValue: 14,
        timeWindow: 'Forward Looking 14 Days',
        sampleMockPayload: {
            employeeId: 'EMP0245',
            employeeName: 'Priya Sundaram',
            daysUntilProbationEnd: 10,
            reportingManagerId: 'MGR012',
            probationEndDate: '2026-10-15'
        },
        sampleDenialPayload: {
            employeeId: 'EMP0245',
            employeeName: 'Priya Sundaram',
            daysUntilProbationEnd: 25,
            reportingManagerId: 'MGR012',
            probationEndDate: '2026-10-30'
        },
        routing: {
            primaryRecipients: ['Reporting Manager', 'HR Talent Partner'],
            channels: ['in_app', 'email'],
            escalationTarget: 'Head of People Operations',
            escalationTimeoutHours: 48,
            webhookEnabled: false,
            webhookEndpointTemplate: ''
        }
    },
    {
        eventKey: 'EVT_RETENTION_1YR_WARNING',
        displayName: '1-Year Tenure Retention Milestone Warning',
        description: 'Monitors employees approaching their 1-year work anniversary who exhibit flight-risk indicators, prompting proactive manager 1-on-1 check-ins.',
        category: 'Talent & Retention',
        module: 'pms',
        severity: 'info',
        parameters: ['employeeId', 'employeeName', 'tenureMonths', 'flightRiskScore', 'reportingManagerId'],
        metric: 'Flight Risk Index Score',
        comparator: '>=',
        thresholdValue: 65,
        timeWindow: 'Tenure Month 11 - 13',
        sampleMockPayload: {
            employeeId: 'EMP0088',
            employeeName: 'Arjun Nambiar',
            tenureMonths: 11.5,
            flightRiskScore: 78,
            reportingManagerId: 'MGR007'
        },
        sampleDenialPayload: {
            employeeId: 'EMP0088',
            employeeName: 'Arjun Nambiar',
            tenureMonths: 11.5,
            flightRiskScore: 32,
            reportingManagerId: 'MGR007'
        },
        routing: {
            primaryRecipients: ['Reporting Manager', 'Department Director'],
            channels: ['in_app', 'email'],
            escalationTarget: 'Talent Retention Taskforce',
            escalationTimeoutHours: 72,
            webhookEnabled: true,
            webhookEndpointTemplate: 'https://hooks.slack.com/services/T00/B00/retention-milestones'
        }
    },
    {
        eventKey: 'EVT_PAYROLL_SPIKE',
        displayName: 'Payroll Variance Anomaly Exceeded (> 10%)',
        description: 'Monitors calculated gross salary disbursements before bank payout; halts automated processing and notifies Finance Controller if disbursement deviates > 10% from historical average.',
        category: 'Financial Safety',
        module: 'payroll',
        severity: 'critical',
        parameters: ['batchId', 'cycleMonth', 'variancePercentage', 'affectedHeadcount', 'totalGross'],
        metric: 'Gross Payroll Variance %',
        comparator: '>',
        thresholdValue: 10,
        timeWindow: 'Pre-Disbursement Audit Batch',
        sampleMockPayload: {
            batchId: 'BATCH-SEP-2026',
            cycleMonth: 'September 2026',
            variancePercentage: 14.8,
            affectedHeadcount: 142,
            totalGross: 9850000
        },
        sampleDenialPayload: {
            batchId: 'BATCH-SEP-2026',
            cycleMonth: 'September 2026',
            variancePercentage: 3.2,
            affectedHeadcount: 142,
            totalGross: 8650000
        },
        routing: {
            primaryRecipients: ['Payroll Admin', 'Finance Controller'],
            channels: ['in_app', 'email', 'sms'],
            escalationTarget: 'Chief Financial Officer',
            escalationTimeoutHours: 6,
            webhookEnabled: true,
            webhookEndpointTemplate: 'https://hooks.slack.com/services/T00/B00/payroll-variance-freeze'
        }
    },
    {
        eventKey: 'EVT_POLICY_UNACKED',
        displayName: 'Mandatory Policy Acknowledgement Overdue (>= 3 Days)',
        description: 'Enforces compliance when mandatory statutory, infosec, or workplace policies remain unacknowledged for 3 or more business days after publication.',
        category: 'Compliance & Governance',
        module: 'policies',
        severity: 'warning',
        parameters: ['policyId', 'policyTitle', 'employeeId', 'unacknowledgedDays', 'reportingManagerId'],
        metric: 'Unacknowledged Duration (Days)',
        comparator: '>=',
        thresholdValue: 3,
        timeWindow: 'Post-Publication Day 3+',
        sampleMockPayload: {
            policyId: 'POL-SEC-2026',
            policyTitle: 'Information Security & Data Protection Standard',
            employeeId: 'EMP0319',
            employeeName: 'Kavita Menon',
            unacknowledgedDays: 4,
            reportingManagerId: 'MGR015'
        },
        sampleDenialPayload: {
            policyId: 'POL-SEC-2026',
            policyTitle: 'Information Security & Data Protection Standard',
            employeeId: 'EMP0319',
            employeeName: 'Kavita Menon',
            unacknowledgedDays: 1,
            reportingManagerId: 'MGR015'
        },
        routing: {
            primaryRecipients: ['Employee', 'Reporting Manager'],
            channels: ['in_app', 'email'],
            escalationTarget: 'Compliance Officer',
            escalationTimeoutHours: 48,
            webhookEnabled: false,
            webhookEndpointTemplate: ''
        }
    },
    {
        eventKey: 'EVT_EXIT_PENDING',
        displayName: 'Exit Clearance SLA Breach Warning (>= 48h)',
        description: 'Monitors open departmental clearance handoffs (IT assets, Finance, Admin) during employee separation; escalates when any department exceeds the 48-hour SLA.',
        category: 'Offboarding & Separation',
        module: 'exit',
        severity: 'critical',
        parameters: ['resignationId', 'employeeId', 'departmentPending', 'pendingDurationHours', 'responsiblePersonId'],
        metric: 'Clearance Stagnation (Hours)',
        comparator: '>=',
        thresholdValue: 48,
        timeWindow: 'Active Exit Clearance Cycle',
        sampleMockPayload: {
            resignationId: 'SEP-2026-089',
            employeeId: 'EMP0054',
            employeeName: 'Vikram Joshi',
            departmentPending: 'IT Asset Return',
            pendingDurationHours: 54,
            responsiblePersonId: 'EMP-IT-002'
        },
        sampleDenialPayload: {
            resignationId: 'SEP-2026-089',
            employeeId: 'EMP0054',
            employeeName: 'Vikram Joshi',
            departmentPending: 'IT Asset Return',
            pendingDurationHours: 18,
            responsiblePersonId: 'EMP-IT-002'
        },
        routing: {
            primaryRecipients: ['Responsible Clearance Owner', 'HR Exit Coordinator'],
            channels: ['in_app', 'email', 'sms'],
            escalationTarget: 'VP of People Operations',
            escalationTimeoutHours: 12,
            webhookEnabled: true,
            webhookEndpointTemplate: 'https://hooks.slack.com/services/T00/B00/exit-clearance-sla'
        }
    }
];

class AlertTriggerRegistryService {
    constructor() {
        this.registry = new Map();
        this._initRegistry();
    }

    _initRegistry() {
        CANONICAL_TRIGGER_REGISTRY.forEach(t => {
            this.registry.set(t.eventKey, { ...t, isActive: true, updatedAt: new Date().toISOString() });
        });
    }

    /**
     * Get all registered triggers with full schema
     */
    getAllTriggers() {
        return Array.from(this.registry.values());
    }

    /**
     * Get single trigger definition by its technical eventKey
     */
    getTriggerByKey(eventKey) {
        if (!eventKey) return null;
        return this.registry.get(eventKey.trim().toUpperCase()) || null;
    }

    /**
     * Upsert a trigger definition in registry
     */
    registerTrigger(triggerData, actor = 'Super Admin') {
        if (!triggerData.eventKey) throw new Error('eventKey is required.');
        const key = triggerData.eventKey.trim().toUpperCase();
        const existing = this.registry.get(key) || {};
        const record = {
            ...existing,
            ...triggerData,
            eventKey: key,
            updatedAt: new Date().toISOString(),
            updatedBy: actor
        };
        this.registry.set(key, record);
        return record;
    }

    /**
     * Safe AI Simulation Sandbox Engine
     * Sandboxed Dry-Run Guarantee: Executes evaluation rules WITHOUT:
     * - Writing changes to Cloud Firestore
     * - Modifying employee records or status
     * - Dispatching real emails or SMS
     * - Calling external webhooks
     */
    runSandboxedDryRun(eventKey, mockPayload = {}, options = {}) {
        const startTime = Date.now();
        const trigger = this.getTriggerByKey(eventKey);

        if (!trigger) {
            return {
                success: false,
                error: `Event key '${eventKey}' is not recognized in Alert Trigger Registry.`,
                dryRunGuarantee: true,
                trace: []
            };
        }

        const trace = [];
        const simId = `SIM_${Date.now()}_${Math.random().toString(36).substring(2, 7).toUpperCase()}`;

        // STAGE 1: Event Reception & Sandbox Isolation
        trace.push({
            stage: 'STAGE 1: TRIGGER RECEIVED',
            status: 'SUCCESS',
            timestamp: new Date().toISOString(),
            details: `Received simulated event '${trigger.eventKey}' (${trigger.displayName}) in sandbox isolated context.`,
            meta: { simId, eventKey: trigger.eventKey, category: trigger.category, dryRunCertified: true }
        });

        // STAGE 2: Parameter Extraction & Schema Validation
        const missingParams = [];
        const extractedParams = {};
        (trigger.parameters || []).forEach(param => {
            if (mockPayload[param] !== undefined && mockPayload[param] !== null) {
                extractedParams[param] = mockPayload[param];
            } else {
                missingParams.push(param);
            }
        });

        trace.push({
            stage: 'STAGE 2: PARAMETER EXTRACTION',
            status: missingParams.length === 0 ? 'SUCCESS' : 'WARNING',
            timestamp: new Date().toISOString(),
            details: `Extracted ${Object.keys(extractedParams).length}/${trigger.parameters.length} parameters.` +
                (missingParams.length > 0 ? ` Missing optional parameters: ${missingParams.join(', ')}` : ' All parameters present.'),
            meta: { extractedParams, missingParams }
        });

        // STAGE 3: Condition & Threshold Evaluation
        let evaluatedValue = null;
        const metricKeys = [
            'consecutiveDays', 'consecutiveAbsences', 'daysUntilProbationEnd',
            'flightRiskScore', 'variancePercentage', 'unacknowledgedDays',
            'pendingDurationHours'
        ];

        for (const k of metricKeys) {
            if (mockPayload[k] !== undefined) {
                evaluatedValue = Number(mockPayload[k]);
                break;
            }
        }

        if (evaluatedValue === null && options.metricValue !== undefined) {
            evaluatedValue = Number(options.metricValue);
        }

        let conditionPassed = false;
        const op = trigger.comparator;
        const thresh = trigger.thresholdValue;

        if (evaluatedValue !== null) {
            switch (op) {
                case '>=': conditionPassed = evaluatedValue >= thresh; break;
                case '>':  conditionPassed = evaluatedValue > thresh; break;
                case '<=': conditionPassed = evaluatedValue <= thresh; break;
                case '<':  conditionPassed = evaluatedValue < thresh; break;
                case '==': conditionPassed = evaluatedValue === thresh; break;
                default:   conditionPassed = evaluatedValue >= thresh;
            }
        }

        trace.push({
            stage: 'STAGE 3: THRESHOLD EVALUATION',
            status: conditionPassed ? 'BREACH_DETECTED' : 'CONDITION_DENIED',
            timestamp: new Date().toISOString(),
            details: `Metric '${trigger.metric}' evaluated: ${evaluatedValue} ${op} ${thresh}. ` +
                (conditionPassed ? `Condition MET (Alert Rule Fired).` : `Condition NOT MET (Alert Suppressed).`),
            meta: {
                metric: trigger.metric,
                actualValue: evaluatedValue,
                comparator: op,
                thresholdValue: thresh,
                conditionPassed
            }
        });

        // STAGE 4: Simulated Routing Paths
        const routing = trigger.routing || {};
        const simulatedRecipients = conditionPassed ? (routing.primaryRecipients || ['Admin']) : [];
        const simulatedChannels = conditionPassed ? (routing.channels || ['in_app']) : [];

        trace.push({
            stage: 'STAGE 4: SIMULATED ROUTING PATH',
            status: conditionPassed ? 'ROUTED' : 'BYPASSED',
            timestamp: new Date().toISOString(),
            details: conditionPassed
                ? `Simulated dispatch to ${simulatedRecipients.length} recipients across channels [${simulatedChannels.join(', ')}].`
                : 'Routing path bypassed because threshold condition was not met.',
            meta: {
                recipients: simulatedRecipients,
                channels: simulatedChannels
            }
        });

        // STAGE 5: SLA Timer & Escalation Simulation
        const escalation = {
            target: routing.escalationTarget || 'None',
            timeoutHours: routing.escalationTimeoutHours || 0,
            simulatedDeadline: new Date(Date.now() + (routing.escalationTimeoutHours || 24) * 3600000).toISOString()
        };

        trace.push({
            stage: 'STAGE 5: SLA TIMER & ESCALATION VALIDATION',
            status: conditionPassed ? 'SLA_SCHEDULED' : 'BYPASSED',
            timestamp: new Date().toISOString(),
            details: conditionPassed
                ? `SLA breach clock set: ${escalation.timeoutHours}h SLA timeout countdown towards '${escalation.target}'. Simulated deadline: ${escalation.simulatedDeadline}.`
                : 'SLA timer not scheduled.',
            meta: escalation
        });

        // STAGE 6: Webhook Dry-Run (Guaranteed Zero Network Dispatch)
        const webhookPlan = {
            enabled: Boolean(routing.webhookEnabled),
            endpoint: routing.webhookEndpointTemplate || '',
            simulatedPayload: {
                event: trigger.eventKey,
                severity: trigger.severity,
                data: mockPayload,
                timestamp: new Date().toISOString(),
                dryRun: true
            }
        };

        trace.push({
            stage: 'STAGE 6: MOCK ACTION DISPATCH (SANDBOXED)',
            status: 'DRY_RUN_GUARD_VERIFIED',
            timestamp: new Date().toISOString(),
            details: `[SAFETY CERTIFIED] Zero external side-effects: 0 Firestore writes, 0 emails dispatched, 0 webhooks fired. Sandbox isolation verified.`,
            meta: { webhookPlan, sideEffectsOccurred: false }
        });

        const executionDurationMs = Date.now() - startTime;

        return {
            success: true,
            simId,
            eventKey: trigger.eventKey,
            displayName: trigger.displayName,
            conditionMet: conditionPassed,
            verdict: conditionPassed ? 'ALERT_TRIGGERED' : 'ALERT_SUPPRESSED',
            executionDurationMs,
            dryRunGuarantee: {
                firestoreWrites: 0,
                emailsSent: 0,
                smsSent: 0,
                webhooksExecuted: 0,
                webhooksFired: 0,
                employeeStatusMutated: false,
                employeeStatusModified: false,
                certifiedSafe: true
            },
            mockPayload,
            trace
        };
    }
}

module.exports = new AlertTriggerRegistryService();
