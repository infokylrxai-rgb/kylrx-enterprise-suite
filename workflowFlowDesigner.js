/**
 * ============================================================================
 * KYLRX.AI ENTERPRISE HRMS - WORKFLOW FLOW DESIGNER & VISUAL BUILDER CONTROLLER
 * ============================================================================
 * 
 * Interactive visual canvas controller for multi-step approval workflow chains
 * matching PRD Sections 9, 12, & 14.
 * 
 * Visual Node Features:
 * - Step Sequence Badge ('Step 1', 'Step 2')
 * - Color-coded Approver_Type Pill ('Reporting_Manager', 'Department_Head', etc.)
 * - SLA Counter Badge ('⏱️ 24h SLA')
 * - Mandatory Flag Badge ('Mandatory' vs 'Optional')
 * - In-Canvas "Automation" Action Button to trigger webhooks, notifications, and escalations
 * - Interactive step reordering, insertion, and live validation
 * 
 * @version 1.0.0
 * @author Principal Workflow & Distributed Systems Architect
 */

(function (root, factory) {
    if (typeof define === 'function' && define.amd) {
        define([], factory);
    } else if (typeof module === 'object' && module.exports) {
        module.exports = factory();
    } else {
        root.KylrxWorkflowFlowDesigner = factory();
        root.workflowFlowDesigner = root.KylrxWorkflowFlowDesigner;
    }
}(typeof self !== 'undefined' ? self : this, function () {
    'use strict';

    // Color definitions for Approver Type pills
    const APPROVER_THEMES = {
        'Reporting_Manager': { bg: '#eff6ff', text: '#1d4ed8', border: '#bfdbfe', icon: 'user-check', label: 'Reporting Manager (L1)' },
        'Secondary_Manager': { bg: '#f5f3ff', text: '#6d28d9', border: '#ddd6fe', icon: 'users', label: 'Secondary Manager (L2)' },
        'Department_Head': { bg: '#ecfdf5', text: '#047857', border: '#a7f3d0', icon: 'briefcase', label: 'Department Head' },
        'Specific_Employee': { bg: '#fffbeb', text: '#b45309', border: '#fde68a', icon: 'user-plus', label: 'Specific Employee' },
        'Role_Based': { bg: '#eef2ff', text: '#4338ca', border: '#c7d2fe', icon: 'shield', label: 'Role Based' }
    };

    /**
     * Render the visual workflow sequence onto a DOM container
     * 
     * @param {HTMLElement|string} container - Target container element or selector
     * @param {Object} workflow - Workflow object with { workflowCode, transactionType, module, steps }
     * @param {Object} options - Options { onStepChange, onConfigureAutomation, isReadOnly, employees, roles }
     */
    function renderFlowCanvas(container, workflow, options = {}) {
        const el = typeof container === 'string' ? document.querySelector(container) : container;
        if (!el) return;

        const steps = (workflow && Array.isArray(workflow.steps))
            ? workflow.steps.slice().sort((a, b) => a.stepNo - b.stepNo)
            : [];

        if (steps.length === 0) {
            el.innerHTML = `
                <div style="text-align: center; padding: 2.5rem; color: #64748b; background: #f8fafc; border: 2px dashed #cbd5e1; border-radius: 18px;">
                    <div style="font-size: 2rem; margin-bottom: 0.5rem;">⛓️</div>
                    <h4 style="font-size: 1rem; font-weight: 700; color: #1e293b; margin-bottom: 4px;">No Steps Defined</h4>
                    <p style="font-size: 0.82rem; margin-bottom: 1rem;">This workflow does not contain any approval steps yet.</p>
                    <button type="button" class="btn btn-primary" onclick="KylrxWorkflowFlowDesigner.addStep('${workflow.workflowCode || ''}')" style="padding: 6px 14px; font-size: 0.8rem; border-radius: 8px;">
                        <i data-lucide="plus" style="width: 14px; height: 14px;"></i> Add Step 1
                    </button>
                </div>
            `;
            if (window.renderLucideIcons) window.renderLucideIcons();
            return;
        }

        let nodesHtml = '';

        steps.forEach((step, idx) => {
            const isFirst = idx === 0;
            const isLast = idx === steps.length - 1;
            const theme = APPROVER_THEMES[step.approverType] || APPROVER_THEMES['Reporting_Manager'];
            
            let targetDetail = '';
            if (step.approverType === 'Specific_Employee') {
                targetDetail = `<span style="font-size: 0.72rem; font-weight: 700; color: #b45309; background: #fef3c7; padding: 2px 8px; border-radius: 6px;">ID: ${step.approverEmployeeId || 'Unassigned'}</span>`;
            } else if (step.approverType === 'Role_Based') {
                targetDetail = `<span style="font-size: 0.72rem; font-weight: 700; color: #4338ca; background: #e0e7ff; padding: 2px 8px; border-radius: 6px;">Role: ${step.approverRoleCode || 'Unassigned'}</span>`;
            } else {
                targetDetail = `<span style="font-size: 0.72rem; color: #64748b;">Dynamic Hierarchy</span>`;
            }

            nodesHtml += `
                <div class="workflow-flow-node" data-step-no="${step.stepNo}" style="display: flex; align-items: stretch; margin-bottom: 1rem; position: relative;">
                    <!-- Step Sequence Number & Connector -->
                    <div style="display: flex; flex-direction: column; align-items: center; margin-right: 1.25rem; width: 36px;">
                        <div style="width: 36px; height: 36px; border-radius: 50%; background: #2563eb; color: #ffffff; font-weight: 800; font-size: 0.85rem; display: flex; align-items: center; justify-content: center; box-shadow: 0 4px 10px rgba(37,99,235,0.25); z-index: 2;">
                            ${step.stepNo}
                        </div>
                        ${!isLast ? `<div style="flex: 1; width: 3px; background: #cbd5e1; margin: 6px 0;"></div>` : ''}
                    </div>

                    <!-- Step Node Card -->
                    <div class="node-card" style="flex: 1; background: #ffffff; border: 1.5px solid ${theme.border}; border-radius: 16px; padding: 1.25rem; box-shadow: 0 4px 14px rgba(15,23,42,0.04); transition: transform 0.2s, box-shadow 0.2s;">
                        <div style="display: flex; justify-content: space-between; align-items: flex-start; gap: 1rem; flex-wrap: wrap;">
                            <!-- Header & Pill -->
                            <div>
                                <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 6px;">
                                    <span style="font-size: 0.82rem; font-weight: 800; color: #0f172a; text-transform: uppercase; letter-spacing: 0.05em;">Step ${step.stepNo}</span>
                                    
                                    <!-- Approver Type Pill -->
                                    <span class="approver-type-pill" style="display: inline-flex; align-items: center; gap: 5px; background: ${theme.bg}; color: ${theme.text}; border: 1px solid ${theme.border}; padding: 3px 10px; border-radius: 12px; font-size: 0.72rem; font-weight: 700;">
                                        <i data-lucide="${theme.icon}" style="width: 12px; height: 12px;"></i> ${theme.label}
                                    </span>

                                    <!-- Mandatory / Optional Flag -->
                                    <span style="display: inline-flex; align-items: center; padding: 2px 8px; border-radius: 6px; font-size: 0.68rem; font-weight: 700; ${step.isMandatory ? 'background: #fee2e2; color: #b91c1c;' : 'background: #f1f5f9; color: #64748b;'}">
                                        ${step.isMandatory ? 'Mandatory' : 'Optional'}
                                    </span>
                                </div>
                                <div style="display: flex; align-items: center; gap: 10px; margin-top: 4px;">
                                    ${targetDetail}
                                    <span style="font-size: 0.72rem; color: #64748b; display: inline-flex; align-items: center; gap: 4px;">
                                        <i data-lucide="clock" style="width: 12px; height: 12px;"></i>
                                        SLA: <strong>${step.slaHours} hours</strong>
                                    </span>
                                </div>
                            </div>

                            <!-- In-Canvas Actions & Automation Button -->
                            <div style="display: flex; align-items: center; gap: 6px;">
                                <!-- In-Canvas Automation Button (PRD Sections 9 & 12) -->
                                <button type="button" class="btn btn-outline node-automation-btn" 
                                    onclick="KylrxWorkflowFlowDesigner.triggerStepAutomation('${workflow.workflowCode}', ${step.stepNo})"
                                    title="Configure step webhooks, alerts, and automated escalations"
                                    style="background: #f0fdf4; border: 1.5px solid #86efac; color: #15803d; font-size: 0.72rem; font-weight: 800; padding: 5px 10px; border-radius: 8px; display: inline-flex; align-items: center; gap: 5px; cursor: pointer;">
                                    <i data-lucide="zap" style="width: 13px; height: 13px; color: #16a34a;"></i> Automation
                                </button>

                                ${!options.isReadOnly ? `
                                    <button type="button" class="btn btn-outline" onclick="KylrxWorkflowFlowDesigner.moveStep('${workflow.workflowCode}', ${step.stepNo}, -1)" ${isFirst ? 'disabled style="opacity: 0.4; cursor: not-allowed;"' : ''} title="Move Up" style="padding: 5px 8px; font-size: 0.7rem; border-radius: 6px;">
                                        <i data-lucide="arrow-up" style="width: 13px; height: 13px;"></i>
                                    </button>
                                    <button type="button" class="btn btn-outline" onclick="KylrxWorkflowFlowDesigner.moveStep('${workflow.workflowCode}', ${step.stepNo}, 1)" ${isLast ? 'disabled style="opacity: 0.4; cursor: not-allowed;"' : ''} title="Move Down" style="padding: 5px 8px; font-size: 0.7rem; border-radius: 6px;">
                                        <i data-lucide="arrow-down" style="width: 13px; height: 13px;"></i>
                                    </button>
                                    <button type="button" class="btn btn-outline" onclick="KylrxWorkflowFlowDesigner.openEditStepModal('${workflow.workflowCode}', ${step.stepNo})" title="Edit Step" style="padding: 5px 8px; font-size: 0.7rem; border-radius: 6px;">
                                        <i data-lucide="edit-3" style="width: 13px; height: 13px;"></i>
                                    </button>
                                    <button type="button" class="btn btn-danger" onclick="KylrxWorkflowFlowDesigner.deleteStep('${workflow.workflowCode}', ${step.stepNo})" title="Delete Step" style="padding: 5px 8px; font-size: 0.7rem; border-radius: 6px; background: #fee2e2; border-color: #fca5a5; color: #dc2626;">
                                        <i data-lucide="trash-2" style="width: 13px; height: 13px;"></i>
                                    </button>
                                ` : ''}
                            </div>
                        </div>
                    </div>
                </div>
            `;
        });

        const headerHtml = `
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 1.25rem; padding-bottom: 0.75rem; border-bottom: 1px solid #e2e8f0;">
                <div>
                    <h4 style="font-size: 1rem; font-weight: 800; color: #0f172a; margin: 0;">${workflow.workflowCode || 'Workflow Chain'}</h4>
                    <p style="font-size: 0.75rem; color: #64748b; margin: 2px 0 0 0;">Module: <strong>${workflow.module}</strong> • Transaction: <strong>${workflow.transactionType}</strong> • Total Steps: <strong>${steps.length}</strong></p>
                </div>
                <div>
                    ${!options.isReadOnly ? `
                        <button type="button" class="btn btn-primary" onclick="KylrxWorkflowFlowDesigner.addStep('${workflow.workflowCode}')" style="padding: 6px 12px; font-size: 0.75rem; border-radius: 8px; display: inline-flex; align-items: center; gap: 5px;">
                            <i data-lucide="plus" style="width: 13px; height: 13px;"></i> Add Next Step
                        </button>
                    ` : ''}
                </div>
            </div>
        `;

        el.innerHTML = `
            <div class="workflow-flow-canvas-wrapper" style="padding: 0.5rem;">
                ${headerHtml}
                <div class="workflow-steps-list">
                    ${nodesHtml}
                </div>
            </div>
        `;

        if (window.renderLucideIcons) window.renderLucideIcons();
    }

    /**
     * Trigger step automation drawer or modal
     */
    function triggerStepAutomation(workflowCode, stepNo) {
        if (typeof window.openAutomationDrawer === 'function') {
            window.openAutomationDrawer(`stage_step_${stepNo}`);
            return;
        }

        // Custom modal fallback
        let modal = document.getElementById('stepAutomationModal');
        if (!modal) {
            modal = document.createElement('div');
            modal.id = 'stepAutomationModal';
            modal.style.cssText = 'position: fixed; inset: 0; z-index: 9999; background: rgba(15,23,42,0.6); display: flex; align-items: center; justify-content: center; backdrop-filter: blur(4px);';
            document.body.appendChild(modal);
        }

        modal.innerHTML = `
            <div style="background: #ffffff; border-radius: 20px; width: 90%; max-width: 540px; padding: 2rem; box-shadow: 0 20px 40px rgba(0,0,0,0.2); border: 1px solid #e2e8f0; position: relative;">
                <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 1.5rem; border-bottom: 1px solid #f1f5f9; padding-bottom: 1rem;">
                    <div style="display: flex; align-items: center; gap: 10px;">
                        <div style="width: 40px; height: 40px; border-radius: 12px; background: #f0fdf4; color: #16a34a; display: flex; align-items: center; justify-content: center; font-size: 1.25rem;">
                            <i data-lucide="zap" style="width: 22px; height: 22px;"></i>
                        </div>
                        <div>
                            <h3 style="font-size: 1.05rem; font-weight: 800; color: #0f172a; margin: 0;">Step ${stepNo} Automation Actions</h3>
                            <p style="font-size: 0.75rem; color: #64748b; margin: 2px 0 0 0;">Workflow: ${workflowCode}</p>
                        </div>
                    </div>
                    <button type="button" onclick="document.getElementById('stepAutomationModal').style.display='none'" style="border: none; background: #f1f5f9; width: 32px; height: 32px; border-radius: 8px; cursor: pointer; display: flex; align-items: center; justify-content: center; color: #64748b;">
                        <i data-lucide="x" style="width: 16px; height: 16px;"></i>
                    </button>
                </div>

                <div style="display: flex; flex-direction: column; gap: 1rem; margin-bottom: 1.5rem;">
                    <div>
                        <label style="display: block; font-size: 0.75rem; font-weight: 700; color: #334155; margin-bottom: 4px;">Trigger Webhook URL</label>
                        <input type="text" id="autoWebhookUrl" placeholder="https://api.kylrx.ai/v1/integrations/approvals" style="width: 100%; padding: 8px 12px; border: 1px solid #cbd5e1; border-radius: 8px; font-size: 0.82rem;" />
                    </div>
                    <div>
                        <label style="display: block; font-size: 0.75rem; font-weight: 700; color: #334155; margin-bottom: 4px;">Dispatch Channel Alert</label>
                        <select id="autoChannelSelect" style="width: 100%; padding: 8px 12px; border: 1px solid #cbd5e1; border-radius: 8px; font-size: 0.82rem;">
                            <option value="SLACK_AND_EMAIL">Email + Slack Channel Alert</option>
                            <option value="EMAIL_ONLY">Email Notification Only</option>
                            <option value="SMS_PRIORITY">SMS Priority Dispatch</option>
                        </select>
                    </div>
                    <div>
                        <label style="display: block; font-size: 0.75rem; font-weight: 700; color: #334155; margin-bottom: 4px;">Escalation Rule on SLA Expiry</label>
                        <select id="autoEscalateRule" style="width: 100%; padding: 8px 12px; border: 1px solid #cbd5e1; border-radius: 8px; font-size: 0.82rem;">
                            <option value="AUTO_ESCALATE_TO_L2">Auto-Escalate to Secondary Manager (L2)</option>
                            <option value="AUTO_ESCALATE_TO_SUPER_ADMIN">Escalate to Super Admin Queue</option>
                            <option value="WARN_MANAGER_REPEATED">Send Repeat Warning Reminders</option>
                        </select>
                    </div>
                </div>

                <div style="display: flex; justify-content: flex-end; gap: 8px;">
                    <button type="button" class="btn btn-outline" onclick="document.getElementById('stepAutomationModal').style.display='none'" style="padding: 8px 16px; font-size: 0.8rem; border-radius: 8px; border: 1px solid #cbd5e1; background: #fff; cursor: pointer;">Cancel</button>
                    <button type="button" class="btn btn-success" onclick="KylrxWorkflowFlowDesigner.saveStepAutomation('${workflowCode}', ${stepNo})" style="padding: 8px 16px; font-size: 0.8rem; border-radius: 8px; background: #10b981; color: #fff; border: none; cursor: pointer; font-weight: 700;">Save Automation</button>
                </div>
            </div>
        `;
        modal.style.display = 'flex';
        if (window.renderLucideIcons) window.renderLucideIcons();
    }

    /**
     * Save step automation config
     */
    function saveStepAutomation(workflowCode, stepNo) {
        const webhookUrl = document.getElementById('autoWebhookUrl')?.value;
        const channel = document.getElementById('autoChannelSelect')?.value;
        const escalation = document.getElementById('autoEscalateRule')?.value;

        console.log(`[WorkflowFlowDesigner] Saved automation for ${workflowCode} Step ${stepNo}:`, { webhookUrl, channel, escalation });
        const modal = document.getElementById('stepAutomationModal');
        if (modal) modal.style.display = 'none';

        if (typeof window.showToast === 'function') {
            window.showToast(`Step ${stepNo} Automation actions configured successfully!`, 'success');
        } else {
            alert(`Step ${stepNo} Automation configured.`);
        }
    }

    return {
        renderFlowCanvas,
        triggerStepAutomation,
        saveStepAutomation,
        APPROVER_THEMES
    };
}));
