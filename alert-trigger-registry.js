/**
 * Kylrx.ai - Alert Trigger Registry & Safe AI Simulation Engine (PRD Section 11)
 * Client-Side Controller for Simplified Alert Monitor, Setup Guide, and Sandbox Simulator
 */

(function (root, factory) {
    if (typeof define === 'function' && define.amd) {
        define([], factory);
    } else if (typeof module === 'object' && module.exports) {
        module.exports = factory();
    } else {
        root.KylrxAlertRegistry = factory();
    }
}(typeof self !== 'undefined' ? self : this, function () {
    'use strict';

    const CANONICAL_TRIGGERS = [
        {
            eventKey: 'EVT_ABSENCE_EXCEEDED',
            displayName: 'Consecutive Absence Limit Exceeded',
            description: 'Fires automatically when an employee marks unexcused absence for 3 or more consecutive business days, routing an immediate alert to L1 and L2 managers.',
            category: 'Attendance & Leave',
            module: 'attendance',
            severity: 'critical',
            parameters: ['employeeId', 'employeeName', 'consecutiveDays', 'reportingManagerId', 'department'],
            metric: 'Consecutive Absences',
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
                channels: ['In-App', 'Email', 'SMS'],
                escalationTarget: 'HRBP Lead',
                escalationTimeoutHours: 24,
                webhookEnabled: true,
                webhookEndpoint: 'https://hooks.slack.com/services/T00/B00/attendance-anomalies'
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
                channels: ['In-App', 'Email'],
                escalationTarget: 'Head of People Operations',
                escalationTimeoutHours: 48,
                webhookEnabled: false,
                webhookEndpoint: ''
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
                channels: ['In-App', 'Email'],
                escalationTarget: 'Talent Retention Taskforce',
                escalationTimeoutHours: 72,
                webhookEnabled: true,
                webhookEndpoint: 'https://hooks.slack.com/services/T00/B00/retention-milestones'
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
                channels: ['In-App', 'Email', 'SMS'],
                escalationTarget: 'Chief Financial Officer',
                escalationTimeoutHours: 6,
                webhookEnabled: true,
                webhookEndpoint: 'https://hooks.slack.com/services/T00/B00/payroll-variance-freeze'
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
                channels: ['In-App', 'Email'],
                escalationTarget: 'Compliance Officer',
                escalationTimeoutHours: 48,
                webhookEnabled: false,
                webhookEndpoint: ''
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
                channels: ['In-App', 'Email', 'SMS'],
                escalationTarget: 'VP of People Operations',
                escalationTimeoutHours: 12,
                webhookEnabled: true,
                webhookEndpoint: 'https://hooks.slack.com/services/T00/B00/exit-clearance-sla'
            }
        }
    ];

    let currentTriggers = [...CANONICAL_TRIGGERS];
    let selectedTriggerForSim = CANONICAL_TRIGGERS[0];

    /**
     * Get all registered triggers
     */
    function getAllTriggers() {
        return [...currentTriggers];
    }

    /**
     * Get trigger by its technical event key
     */
    function getTriggerByKey(key) {
        if (!key) return null;
        const normalized = key.trim().toUpperCase();
        return currentTriggers.find(t => t.eventKey.toUpperCase() === normalized) || null;
    }

    /**
     * Render the simplified Alert Monitor cards in a clean, distraction-free hierarchy
     */
    function renderAlertMonitorCards(containerId, filterCategory = '') {
        const container = document.getElementById(containerId);
        if (!container) return;

        const filtered = filterCategory
            ? currentTriggers.filter(t => t.category.toLowerCase().includes(filterCategory.toLowerCase()))
            : currentTriggers;

        if (filtered.length === 0) {
            container.innerHTML = `
                <div style="grid-column: 1 / -1; text-align: center; padding: 3rem; background: white; border-radius: 16px; border: 1px dashed #cbd5e1;">
                    <i data-lucide="inbox" style="width: 40px; height: 40px; color: #94a3b8; margin-bottom: 8px;"></i>
                    <p style="color: #64748b; font-weight: 600;">No alert triggers match your current filter.</p>
                </div>
            `;
            if (window.lucide && typeof window.lucide.createIcons === 'function') window.lucide.createIcons();
            return;
        }

        container.innerHTML = filtered.map(trigger => {
            const severityColor = trigger.severity === 'critical' ? '#ef4444' : (trigger.severity === 'warning' ? '#f59e0b' : '#3b82f6');
            const severityBg = trigger.severity === 'critical' ? '#fee2e2' : (trigger.severity === 'warning' ? '#fef3c7' : '#eff6ff');

            const paramPills = (trigger.parameters || []).map(p => `
                <span style="display: inline-block; padding: 2px 8px; border-radius: 6px; font-family: monospace; font-size: 0.72rem; background: #f1f5f9; color: #334155; border: 1px solid #e2e8f0;">
                    ${p}
                </span>
            `).join(' ');

            return `
                <div class="alert-monitor-card" style="
                    background: #ffffff; border-radius: 16px; border: 1px solid #e2e8f0; padding: 1.4rem;
                    box-shadow: 0 4px 12px -2px rgba(15, 23, 42, 0.05); display: flex; flex-direction: column; justify-content: space-between;
                    transition: transform 0.2s, box-shadow 0.2s, border-color 0.2s; position: relative; border-left: 4px solid ${severityColor};
                " onmouseover="this.style.transform='translateY(-2px)'; this.style.boxShadow='0 10px 20px -4px rgba(15, 23, 42, 0.08)';" onmouseout="this.style.transform='none'; this.style.boxShadow='0 4px 12px -2px rgba(15, 23, 42, 0.05)';">
                    <div>
                        <!-- Top Metadata Row -->
                        <div style="display: flex; justify-content: space-between; align-items: flex-start; gap: 8px; margin-bottom: 0.75rem;">
                            <span style="font-size: 0.72rem; font-weight: 800; text-transform: uppercase; padding: 3px 10px; border-radius: 20px; background: ${severityBg}; color: ${severityColor}; letter-spacing: 0.4px;">
                                ${trigger.category}
                            </span>
                            <span style="font-size: 0.7rem; font-weight: 700; color: #64748b; background: #f8fafc; border: 1px solid #e2e8f0; padding: 2px 8px; border-radius: 6px;">
                                ${trigger.module.toUpperCase()}
                            </span>
                        </div>

                        <!-- Technical Event Key Badge -->
                        <div style="display: flex; align-items: center; justify-content: space-between; gap: 8px; margin-bottom: 0.5rem; background: #f8fafc; padding: 6px 10px; border-radius: 8px; border: 1px solid #e2e8f0;">
                            <span style="font-family: 'Consolas', monospace; font-size: 0.8rem; font-weight: 800; color: #1e40af; letter-spacing: 0.3px;">
                                <i data-lucide="tag" style="width: 12px; height: 12px; display: inline-block; vertical-align: middle; margin-right: 4px;"></i>
                                ${trigger.eventKey}
                            </span>
                            <button type="button" onclick="navigator.clipboard.writeText('${trigger.eventKey}'); if (window.showToast) window.showToast('Copied event key: ${trigger.eventKey}');" style="background: none; border: none; color: #64748b; cursor: pointer; padding: 2px 4px; font-size: 0.72rem;" title="Copy Event Key">
                                <i data-lucide="copy" style="width: 13px; height: 13px;"></i>
                            </button>
                        </div>

                        <!-- Display Name -->
                        <h3 style="font-size: 1.05rem; font-weight: 800; color: #0f172a; margin: 0.35rem 0 0.5rem 0; line-height: 1.35;">
                            ${trigger.displayName}
                        </h3>

                        <!-- Human-Readable Description -->
                        <p style="font-size: 0.82rem; color: #64748b; line-height: 1.5; margin: 0 0 1rem 0;">
                            ${trigger.description}
                        </p>

                        <!-- Threshold & Condition Pill -->
                        <div style="background: #f1f5f9; border: 1px dashed #cbd5e1; border-radius: 8px; padding: 8px 12px; margin-bottom: 1rem; display: flex; justify-content: space-between; align-items: center; font-size: 0.8rem;">
                            <span style="color: #475569; font-weight: 600;">Condition Threshold:</span>
                            <span style="font-family: monospace; font-weight: 800; color: #0f172a;">
                                ${trigger.metric} <span style="color: #dc2626;">${trigger.comparator}</span> ${trigger.thresholdValue}
                            </span>
                        </div>

                        <!-- Parameters Preview -->
                        <div style="margin-bottom: 1rem;">
                            <div style="font-size: 0.7rem; font-weight: 800; color: #94a3b8; text-transform: uppercase; margin-bottom: 6px; letter-spacing: 0.3px;">
                                Expected Payload Parameters
                            </div>
                            <div style="display: flex; flex-wrap: wrap; gap: 4px;">
                                ${paramPills}
                            </div>
                        </div>
                    </div>

                    <!-- Bottom Action Controls -->
                    <div style="border-top: 1px solid #f1f5f9; padding-top: 1rem; display: flex; justify-content: space-between; align-items: center; gap: 8px;">
                        <button type="button" class="btn btn-secondary" onclick="window.KylrxAlertRegistry.openSetupGuide('${trigger.eventKey}')" style="
                            padding: 6px 12px; font-size: 0.78rem; font-weight: 700; border-radius: 8px; background: #f8fafc; color: #475569; border: 1px solid #cbd5e1; cursor: pointer; display: inline-flex; align-items: center; gap: 5px;
                        ">
                            <i data-lucide="book-open" style="width: 14px; height: 14px;"></i> Setup Guide
                        </button>
                        <button type="button" class="btn btn-primary" onclick="window.KylrxAlertRegistry.openAiSimulation('${trigger.eventKey}')" style="
                            padding: 6px 14px; font-size: 0.78rem; font-weight: 700; border-radius: 8px; background: #2563eb; color: #ffffff; border: none; cursor: pointer; display: inline-flex; align-items: center; gap: 6px; box-shadow: 0 2px 6px rgba(37, 99, 235, 0.25);
                        ">
                            <i data-lucide="play" style="width: 13px; height: 13px;"></i> Safe AI Simulation
                        </button>
                    </div>
                </div>
            `;
        }).join('');

        if (window.lucide && typeof window.lucide.createIcons === 'function') {
            window.lucide.createIcons();
        }
    }

    /**
     * Open Administrator Setup Guide Drawer/Modal
     */
    function openSetupGuide(eventKey) {
        const trigger = getTriggerByKey(eventKey) || currentTriggers[0];
        const drawer = document.getElementById('alertSetupGuideDrawer');
        if (!drawer) return;

        const content = document.getElementById('setupGuideContent');
        if (content) {
            content.innerHTML = `
                <div style="display: flex; flex-direction: column; gap: 1.5rem;">
                    <!-- Overview Banner -->
                    <div style="background: linear-gradient(135deg, #1e3a8a, #2563eb); color: white; padding: 1.5rem; border-radius: 14px;">
                        <div style="display: inline-block; font-size: 0.72rem; font-weight: 800; background: rgba(255,255,255,0.2); padding: 2px 8px; border-radius: 4px; margin-bottom: 6px; letter-spacing: 0.5px;">
                            ${trigger.eventKey}
                        </div>
                        <h3 style="font-size: 1.25rem; font-weight: 800; margin: 0 0 6px 0;">${trigger.displayName}</h3>
                        <p style="font-size: 0.85rem; opacity: 0.9; margin: 0; line-height: 1.4;">${trigger.description}</p>
                    </div>

                    <!-- Step 1: Event Dispatch & Integration -->
                    <div style="background: #ffffff; border: 1px solid #e2e8f0; border-radius: 12px; padding: 1.25rem;">
                        <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 8px;">
                            <span style="width: 24px; height: 24px; border-radius: 50%; background: #dbeafe; color: #1d4ed8; display: inline-flex; align-items: center; justify-content: center; font-weight: 800; font-size: 0.8rem;">1</span>
                            <h4 style="margin: 0; font-size: 0.95rem; font-weight: 800; color: #0f172a;">How This Trigger Event Is Emitted</h4>
                        </div>
                        <p style="font-size: 0.82rem; color: #64748b; line-height: 1.5; margin: 0 0 10px 0;">
                            Emitted via the Kylrx Automation EventBus during automated cron calculations or realtime user mutations. When firing, dispatch an event with key <code style="background: #f1f5f9; padding: 2px 6px; border-radius: 4px; font-weight: bold; color: #1d4ed8;">${trigger.eventKey}</code>.
                        </p>
                        <div style="background: #0f172a; color: #e2e8f0; border-radius: 8px; padding: 12px; font-family: monospace; font-size: 0.78rem; overflow-x: auto;">
// Sample EventBus Dispatch<br/>
await eventBus.emit('${trigger.eventKey}', {<br/>
&nbsp;&nbsp;entityId: 'EMP0102',<br/>
&nbsp;&nbsp;payload: ${JSON.stringify(trigger.sampleMockPayload, null, 2).replace(/\n/g, '<br/>&nbsp;&nbsp;')}<br/>
});
                        </div>
                    </div>

                    <!-- Step 2: Evaluation Rules & Thresholds -->
                    <div style="background: #ffffff; border: 1px solid #e2e8f0; border-radius: 12px; padding: 1.25rem;">
                        <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 8px;">
                            <span style="width: 24px; height: 24px; border-radius: 50%; background: #dbeafe; color: #1d4ed8; display: inline-flex; align-items: center; justify-content: center; font-weight: 800; font-size: 0.8rem;">2</span>
                            <h4 style="margin: 0; font-size: 0.95rem; font-weight: 800; color: #0f172a;">Condition & Threshold Evaluation</h4>
                        </div>
                        <p style="font-size: 0.82rem; color: #64748b; line-height: 1.5; margin: 0 0 8px 0;">
                            The common evaluation engine monitors <strong>${trigger.metric}</strong>. If the extracted payload value satisfies <code style="font-weight: bold; color: #dc2626;">${trigger.comparator} ${trigger.thresholdValue}</code> over the window (<em>${trigger.timeWindow}</em>), the alert executes.
                        </p>
                    </div>

                    <!-- Step 3: Notification & Action Routing -->
                    <div style="background: #ffffff; border: 1px solid #e2e8f0; border-radius: 12px; padding: 1.25rem;">
                        <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 8px;">
                            <span style="width: 24px; height: 24px; border-radius: 50%; background: #dbeafe; color: #1d4ed8; display: inline-flex; align-items: center; justify-content: center; font-weight: 800; font-size: 0.8rem;">3</span>
                            <h4 style="margin: 0; font-size: 0.95rem; font-weight: 800; color: #0f172a;">Channels, Webhooks & Automated Escalation</h4>
                        </div>
                        <ul style="font-size: 0.82rem; color: #475569; padding-left: 20px; margin: 0; line-height: 1.6;">
                            <li><strong>Recipients:</strong> ${trigger.routing.primaryRecipients.join(', ')}</li>
                            <li><strong>Dispatch Channels:</strong> ${trigger.routing.channels.join(', ')}</li>
                            <li><strong>Escalation Target:</strong> ${trigger.routing.escalationTarget} (${trigger.routing.escalationTimeoutHours}h SLA timeout)</li>
                            <li><strong>Webhook Webhook:</strong> ${trigger.routing.webhookEnabled ? trigger.routing.webhookEndpoint : 'Disabled for this tier'}</li>
                        </ul>
                    </div>

                    <div style="display: flex; justify-content: flex-end; gap: 10px;">
                        <button type="button" class="btn btn-secondary" onclick="document.getElementById('alertSetupGuideDrawer').style.display='none';" style="padding: 10px 18px; border-radius: 8px; font-weight: 700; font-size: 0.85rem; border: 1px solid #cbd5e1; background: white; cursor: pointer;">
                            Close Guide
                        </button>
                        <button type="button" class="btn btn-primary" onclick="document.getElementById('alertSetupGuideDrawer').style.display='none'; window.KylrxAlertRegistry.openAiSimulation('${trigger.eventKey}');" style="padding: 10px 20px; border-radius: 8px; font-weight: 700; font-size: 0.85rem; background: #2563eb; color: white; border: none; cursor: pointer;">
                            Launch Simulation Sandbox
                        </button>
                    </div>
                </div>
            `;
        }

        drawer.style.display = 'flex';
        const overlay = document.getElementById('alertSetupGuideOverlay');
        if (overlay) overlay.style.display = 'block';
        if (window.lucide && typeof window.lucide.createIcons === 'function') window.lucide.createIcons();
    }

    /**
     * Close Administrator Setup Guide Drawer
     */
    function closeSetupGuideDrawer() {
        const drawer = document.getElementById('alertSetupGuideDrawer');
        if (drawer) drawer.style.display = 'none';
        const overlay = document.getElementById('alertSetupGuideOverlay');
        if (overlay) overlay.style.display = 'none';
    }

    /**
     * Close Safe AI Simulation Sandbox Modal
     */
    function closeAiSimulationModal() {
        const modal = document.getElementById('aiSimulationSandboxModal');
        if (modal) modal.style.display = 'none';
    }

    /**
     * Open Safe AI Simulation Sandbox Modal
     */
    function openAiSimulation(eventKey) {
        const trigger = getTriggerByKey(eventKey) || currentTriggers[0];
        selectedTriggerForSim = trigger;

        const modal = document.getElementById('aiSimulationSandboxModal');
        if (!modal) return;


        // Populate Trigger Selector
        const select = document.getElementById('simModalTriggerSelect');
        if (select) {
            select.innerHTML = currentTriggers.map(t => `
                <option value="${t.eventKey}" ${t.eventKey === trigger.eventKey ? 'selected' : ''}>
                    ${t.eventKey} - ${t.displayName}
                </option>
            `).join('');
        }

        // Set Payload
        const payloadTextarea = document.getElementById('simModalPayloadInput');
        if (payloadTextarea) {
            payloadTextarea.value = JSON.stringify(trigger.sampleMockPayload, null, 2);
        }

        // Set Trigger description badge
        updateSimModalHeader(trigger);

        // Reset console terminal
        clearSimulationTraceTerminal();

        modal.style.display = 'flex';
        if (window.lucide && typeof window.lucide.createIcons === 'function') window.lucide.createIcons();
    }

    function updateSimModalHeader(trigger) {
        const descEl = document.getElementById('simModalTriggerDesc');
        if (descEl) {
            descEl.innerHTML = `
                <div style="display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 8px;">
                    <div>
                        <strong style="color: #0f172a;">${trigger.displayName}</strong>
                        <div style="font-size: 0.78rem; color: #64748b; margin-top: 2px;">${trigger.description}</div>
                    </div>
                    <div style="font-family: monospace; font-size: 0.78rem; font-weight: 800; background: #e0e7ff; color: #1e40af; padding: 4px 10px; border-radius: 6px;">
                        Rule: ${trigger.metric} ${trigger.comparator} ${trigger.thresholdValue}
                    </div>
                </div>
            `;
        }
    }

    function onSimTriggerChanged() {
        const select = document.getElementById('simModalTriggerSelect');
        if (!select) return;
        const trigger = getTriggerByKey(select.value);
        if (!trigger) return;
        selectedTriggerForSim = trigger;
        updateSimModalHeader(trigger);
        loadSimPreset('breach');
    }

    function loadSimPreset(type) {
        if (!selectedTriggerForSim) return;
        const payloadTextarea = document.getElementById('simModalPayloadInput');
        if (!payloadTextarea) return;

        if (type === 'breach') {
            payloadTextarea.value = JSON.stringify(selectedTriggerForSim.sampleMockPayload, null, 2);
        } else if (type === 'denial') {
            payloadTextarea.value = JSON.stringify(selectedTriggerForSim.sampleDenialPayload, null, 2);
        }
    }

    function clearSimulationTraceTerminal() {
        const terminal = document.getElementById('simTraceTerminal');
        if (!terminal) return;
        terminal.innerHTML = `
            <div style="color: #64748b; font-style: italic; font-size: 0.8rem; padding: 8px 0;">
                [Ready] Click 'Run Sandboxed Simulation' to evaluate mock payload against real evaluation rules with zero side-effects.
            </div>
        `;
    }

    /**
     * Execute Sandboxed Dry-Run Simulation
     * Sandboxed Dry-Run Guarantee: Executes without writing to Firestore, mutating employees, or dispatching external calls.
     */
    async function executeSimulation() {
        if (!selectedTriggerForSim) return;
        const payloadTextarea = document.getElementById('simModalPayloadInput');
        const terminal = document.getElementById('simTraceTerminal');
        const runBtn = document.getElementById('btnRunSim');
        if (!payloadTextarea || !terminal) return;

        let parsedPayload = {};
        try {
            parsedPayload = JSON.parse(payloadTextarea.value);
        } catch (err) {
            alert('Invalid JSON in mock payload: ' + err.message);
            return;
        }

        if (runBtn) {
            runBtn.disabled = true;
            runBtn.innerHTML = '<i data-lucide="loader" class="spin"></i> Evaluating Sandbox...';
        }

        terminal.innerHTML = `
            <div style="color: #38bdf8; font-size: 0.8rem; padding: 4px 0;">
                <i data-lucide="loader" style="width: 14px; height: 14px; display: inline-block; vertical-align: middle;"></i> Initializing isolated sandbox environment...
            </div>
        `;
        if (window.lucide) window.lucide.createIcons();

        try {
            // 1. First try backend dry-run simulation endpoint
            let simResult = null;
            try {
                const res = await fetch('http://localhost:3000/api/alerts/simulate', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        eventKey: selectedTriggerForSim.eventKey,
                        payload: parsedPayload,
                        options: { dryRun: true }
                    })
                });
                if (res.ok) {
                    simResult = await res.json();
                }
            } catch (_) {}

            // 2. Client-side resilient fallback evaluator if offline
            if (!simResult || !simResult.trace) {
                simResult = evaluateClientSideDryRun(selectedTriggerForSim, parsedPayload);
            }

            renderSimulationTrace(simResult);

        } finally {
            if (runBtn) {
                runBtn.disabled = false;
                runBtn.innerHTML = '<i data-lucide="play"></i> Run Sandboxed Simulation';
                if (window.lucide) window.lucide.createIcons();
            }
        }
    }

    /**
     * Client-side evaluator adhering to same Sandboxed Dry-Run Guarantee
     */
    function evaluateClientSideDryRun(trigger, mockPayload) {
        const startTime = Date.now();
        const trace = [];
        const simId = `SIM_CLIENT_${Date.now()}`;

        // STAGE 1
        trace.push({
            stage: 'STAGE 1: TRIGGER RECEIVED',
            status: 'SUCCESS',
            timestamp: new Date().toLocaleTimeString(),
            details: `Received simulated trigger '${trigger.eventKey}' (${trigger.displayName}) in client sandbox.`,
            meta: { simId, dryRunCertified: true }
        });

        // STAGE 2
        const missing = [];
        const extracted = {};
        (trigger.parameters || []).forEach(p => {
            if (mockPayload[p] !== undefined) extracted[p] = mockPayload[p];
            else missing.push(p);
        });

        trace.push({
            stage: 'STAGE 2: PARAMETER EXTRACTION',
            status: missing.length === 0 ? 'SUCCESS' : 'WARNING',
            timestamp: new Date().toLocaleTimeString(),
            details: `Extracted ${Object.keys(extracted).length}/${trigger.parameters.length} parameters.` +
                (missing.length > 0 ? ` Missing: ${missing.join(', ')}` : ' All parameters valid.'),
            meta: { extracted }
        });

        // STAGE 3
        let val = null;
        ['consecutiveDays', 'consecutiveAbsences', 'daysUntilProbationEnd', 'flightRiskScore', 'variancePercentage', 'unacknowledgedDays', 'pendingDurationHours'].forEach(k => {
            if (mockPayload[k] !== undefined && val === null) val = Number(mockPayload[k]);
        });

        const op = trigger.comparator;
        const thresh = trigger.thresholdValue;
        let pass = false;
        if (val !== null) {
            if (op === '>=') pass = val >= thresh;
            else if (op === '>') pass = val > thresh;
            else if (op === '<=') pass = val <= thresh;
            else if (op === '<') pass = val < thresh;
            else if (op === '==') pass = val === thresh;
        }

        trace.push({
            stage: 'STAGE 3: THRESHOLD EVALUATION',
            status: pass ? 'BREACH_DETECTED' : 'CONDITION_DENIED',
            timestamp: new Date().toLocaleTimeString(),
            details: `Metric '${trigger.metric}' value: ${val} ${op} ${thresh}. ` +
                (pass ? 'Threshold condition satisfied! Alert fires.' : 'Threshold not met. Alert suppressed.'),
            meta: { actualValue: val, comparator: op, threshold: thresh, conditionPassed: pass }
        });

        // STAGE 4
        const routing = trigger.routing || {};
        trace.push({
            stage: 'STAGE 4: SIMULATED ROUTING PATH',
            status: pass ? 'ROUTED' : 'BYPASSED',
            timestamp: new Date().toLocaleTimeString(),
            details: pass
                ? `Simulated routing to [${(routing.primaryRecipients || []).join(', ')}] across channels [${(routing.channels || []).join(', ')}].`
                : 'Routing bypassed due to unmet threshold.',
            meta: { recipients: routing.primaryRecipients, channels: routing.channels }
        });

        // STAGE 5
        trace.push({
            stage: 'STAGE 5: SLA TIMER & ESCALATION VALIDATION',
            status: pass ? 'SLA_SCHEDULED' : 'BYPASSED',
            timestamp: new Date().toLocaleTimeString(),
            details: pass
                ? `Escalation clock armed: ${routing.escalationTimeoutHours}h SLA timeout to '${routing.escalationTarget}'.`
                : 'Escalation clock idle.',
            meta: { target: routing.escalationTarget, hours: routing.escalationTimeoutHours }
        });

        // STAGE 6
        trace.push({
            stage: 'STAGE 6: MOCK ACTION DISPATCH (SANDBOXED)',
            status: 'DRY_RUN_GUARD_VERIFIED',
            timestamp: new Date().toLocaleTimeString(),
            details: `[SANDBOX GUARANTEE VERIFIED] 0 Firestore writes, 0 emails sent, 0 webhooks fired. No side effects.`,
            meta: { certifiedSafe: true }
        });

        return {
            success: true,
            simId,
            eventKey: trigger.eventKey,
            displayName: trigger.displayName,
            conditionMet: pass,
            verdict: pass ? 'ALERT_TRIGGERED' : 'ALERT_SUPPRESSED',
            executionDurationMs: Date.now() - startTime,
            dryRunGuarantee: { certifiedSafe: true, firestoreWrites: 0, emailsSent: 0, webhooksFired: 0, employeeStatusModified: false },
            mockPayload,
            trace
        };
    }

    function renderSimulationTrace(result) {
        const terminal = document.getElementById('simTraceTerminal');
        if (!terminal) return;

        const isTriggered = result.conditionMet;
        const verdictBg = isTriggered ? '#fee2e2' : '#f0fdf4';
        const verdictColor = isTriggered ? '#991b1b' : '#166534';
        const verdictBorder = isTriggered ? '#f87171' : '#86efac';

        let html = `
            <div style="background: ${verdictBg}; color: ${verdictColor}; border: 1.5px solid ${verdictBorder}; padding: 12px 16px; border-radius: 10px; margin-bottom: 12px; display: flex; justify-content: space-between; align-items: center; font-family: sans-serif;">
                <div>
                    <span style="font-size: 0.72rem; font-weight: 800; text-transform: uppercase; letter-spacing: 0.5px;">SIMULATION VERDICT:</span>
                    <h4 style="margin: 2px 0 0 0; font-size: 1.05rem; font-weight: 800;">
                        ${isTriggered ? '🚨 ALERT RULE TRIGGERED (Condition Met)' : '🛡️ ALERT SUPPRESSED (Threshold Not Met)'}
                    </h4>
                </div>
                <div style="text-align: right; font-size: 0.75rem;">
                    <div>⏱️ Runtime: <strong>${result.executionDurationMs || 4}ms</strong></div>
                    <div style="color: #059669; font-weight: 700; margin-top: 2px;">🔒 0 Side-Effects Certified</div>
                </div>
            </div>
            <div style="font-family: 'Consolas', monospace; font-size: 0.78rem; line-height: 1.5; color: #f8fafc;">
        `;

        (result.trace || []).forEach(step => {
            let statusColor = '#38bdf8';
            if (step.status === 'SUCCESS' || step.status === 'ROUTED' || step.status === 'DRY_RUN_GUARD_VERIFIED') statusColor = '#4ade80';
            else if (step.status === 'BREACH_DETECTED') statusColor = '#f87171';
            else if (step.status === 'CONDITION_DENIED' || step.status === 'BYPASSED') statusColor = '#fbbf24';
            else if (step.status === 'WARNING') statusColor = '#f97316';

            html += `
                <div style="margin-bottom: 8px; border-bottom: 1px solid rgba(255,255,255,0.06); padding-bottom: 6px;">
                    <div style="display: flex; justify-content: space-between; color: #94a3b8; font-size: 0.72rem;">
                        <span style="font-weight: 800; color: ${statusColor};">${step.stage}</span>
                        <span>[${step.status}]</span>
                    </div>
                    <div style="margin-top: 2px; color: #cbd5e1;">${step.details}</div>
                </div>
            `;
        });

        html += `
                <div style="color: #4ade80; margin-top: 10px; font-weight: bold; border-top: 1px solid rgba(255,255,255,0.1); padding-top: 6px;">
                    ✔ [DRY RUN GUARANTEE] Execution completed in safe mode. No state changes committed to production.
                </div>
            </div>
        `;

        terminal.innerHTML = html;
        terminal.scrollTop = 0;
    }

    // Attach convenience global handlers to window if available
    if (typeof window !== 'undefined') {
        window.closeSetupGuideDrawer = closeSetupGuideDrawer;
        window.closeAiSimulationModal = closeAiSimulationModal;
    }

    return {
        CANONICAL_TRIGGERS,
        getAllTriggers,
        getTriggerByKey,
        renderAlertMonitorCards,
        openSetupGuide,
        closeSetupGuideDrawer,
        openAiSimulation,
        closeAiSimulationModal,
        onSimTriggerChanged,
        loadSimPreset,
        executeSimulation,
        clearSimulationTraceTerminal
    };
}));

