/**
 * ============================================================================
 * KYLRX.AI ENTERPRISE HRMS - WORKFLOW RULES PARSER & CHAIN VALIDATOR ENGINE
 * ============================================================================
 * 
 * Ingests, validates, deduplicates, and groups multi-step approval workflow rules
 * from the 'Workflow Rules' sheet of Templates.xlsx or CSV uploads matching
 * PRD Sections 1, 9, 12, 14, & 18.
 * 
 * Exact 10 Attributes Schema:
 * 1. Workflow_Code (string, workflow identifier)
 * 2. Module (enum: "Leave", "Attendance", "Payroll", "PMS", "Expenses", "Lifecycle")
 * 3. Transaction_Type (string: e.g. "Leave_Application", "Attendance_Regularization", "Salary_Revision")
 * 4. Step_No (number: 1, 2, 3... sequence execution order)
 * 5. Approver_Type (enum: "Reporting_Manager", "Secondary_Manager", "Department_Head", "Specific_Employee", "Role_Based")
 * 6. Approver_Employee_ID (string | null: mandatory if Approver_Type is "Specific_Employee")
 * 7. Approver_Role_Code (string | null: mandatory if Approver_Type is "Role_Based")
 * 8. SLA_Hours (number, turnaround window in hours)
 * 9. Mandatory (boolean: true for "Yes", false for "No")
 * 10. Active (boolean: true for "Yes", false for "No")
 * 
 * Grouping:
 * Transforms tabular multi-row step definitions into unified, hierarchical
 * Cloud Firestore workflow documents mapped to `organizations/{orgId}/workflows/{workflowCode}`.
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
        root.KylrxWorkflowRulesParser = factory();
        root.workflowRulesParser = root.KylrxWorkflowRulesParser;
    }
}(typeof self !== 'undefined' ? self : this, function () {
    'use strict';

    // Canonical Header Synonyms for resilient CSV / Excel column mapping
    const HEADER_SYNONYMS = {
        workflowCode: [
            'workflow_code', 'workflowcode', 'wf_code', 'wfcode', 'workflow_id', 'workflowid',
            'workflow_identifier', 'code', 'id'
        ],
        module: [
            'module', 'module_name', 'modulename', 'domain', 'app_module', 'module_code'
        ],
        transactionType: [
            'transaction_type', 'transactiontype', 'trx_type', 'trxtype', 'event_type',
            'action_type', 'request_type', 'process_type', 'sub_type'
        ],
        stepNo: [
            'step_no', 'stepno', 'step_number', 'stepnumber', 'step', 'sequence', 'sequence_no',
            'level', 'order', 'tier'
        ],
        approverType: [
            'approver_type', 'approvertype', 'target_type', 'approver', 'approval_tier',
            'routing_type', 'approver_category'
        ],
        approverEmployeeId: [
            'approver_employee_id', 'approver_emp_id', 'approver_employee_code', 'approver_code',
            'specific_employee_id', 'approver_id', 'employee_id', 'emp_id', 'assigned_employee_id'
        ],
        approverRoleCode: [
            'approver_role_code', 'approver_role', 'role_code', 'target_role', 'role',
            'approver_role_id', 'role_id'
        ],
        slaHours: [
            'sla_hours', 'slahours', 'sla', 'turnaround_hours', 'sla_window_hours',
            'turnaround_time_hours', 'hours_sla', 'sla_window'
        ],
        mandatory: [
            'mandatory', 'is_mandatory', 'ismandatory', 'required', 'is_required', 'compulsory'
        ],
        active: [
            'active', 'is_active', 'isactive', 'status', 'enabled', 'in_use'
        ]
    };

    // Valid Enum Definitions
    const ALLOWED_MODULES = [
        "Leave",
        "Attendance",
        "Payroll",
        "PMS",
        "Expenses",
        "Lifecycle"
    ];

    const ALLOWED_APPROVER_TYPES = [
        "Reporting_Manager",
        "Secondary_Manager",
        "Department_Head",
        "Specific_Employee",
        "Role_Based"
    ];

    /**
     * Normalize key string for synonym matching
     */
    function normalizeHeaderKey(key) {
        if (!key) return '';
        return String(key)
            .toLowerCase()
            .trim()
            .replace(/[^a-z0-9]/g, '_')
            .replace(/_+/g, '_')
            .replace(/^_|_$/g, '');
    }

    /**
     * Map a raw row object using synonyms to canonical attributes
     */
    function mapRowToCanonical(rawRow) {
        const canonical = {};
        const keys = Object.keys(rawRow);

        for (const [canonicalField, synonyms] of Object.entries(HEADER_SYNONYMS)) {
            for (const key of keys) {
                const normKey = normalizeHeaderKey(key);
                if (synonyms.includes(normKey)) {
                    canonical[canonicalField] = rawRow[key];
                    break;
                }
            }
        }
        return canonical;
    }

    /**
     * Parse boolean string / value
     */
    function parseBoolean(val, defaultVal = true) {
        if (val === undefined || val === null || val === '') return defaultVal;
        if (typeof val === 'boolean') return val;
        const s = String(val).trim().toLowerCase();
        if (['yes', 'true', '1', 'y', 'active', 'enabled', 'mandatory'].includes(s)) return true;
        if (['no', 'false', '0', 'n', 'inactive', 'disabled', 'optional'].includes(s)) return false;
        return defaultVal;
    }

    /**
     * Sanitize module enum
     */
    function sanitizeModule(val) {
        if (!val) return 'Leave';
        const str = String(val).trim();
        const found = ALLOWED_MODULES.find(m => m.toLowerCase() === str.toLowerCase());
        return found || 'Leave';
    }

    /**
     * Sanitize approver type enum
     */
    function sanitizeApproverType(val) {
        if (!val) return 'Reporting_Manager';
        const str = String(val).trim().replace(/[\s-]+/g, '_');
        const found = ALLOWED_APPROVER_TYPES.find(a => a.toLowerCase() === str.toLowerCase());
        if (found) return found;

        // Common aliases
        const low = str.toLowerCase();
        if (low.includes('reporting') || low === 'l1' || low === 'manager' || low === 'rm') {
            return 'Reporting_Manager';
        }
        if (low.includes('secondary') || low === 'l2' || low === 'skip_manager') {
            return 'Secondary_Manager';
        }
        if (low.includes('dept') || low.includes('department') || low === 'hod') {
            return 'Department_Head';
        }
        if (low.includes('employee') || low.includes('emp') || low.includes('specific')) {
            return 'Specific_Employee';
        }
        if (low.includes('role') || low.includes('group')) {
            return 'Role_Based';
        }

        return 'Reporting_Manager';
    }

    /**
     * Validate an individual row record
     */
    function validateStepRecord(step, index, refData = {}) {
        const errors = [];
        const warnings = [];

        // 1. Workflow_Code
        if (!step.workflowCode || String(step.workflowCode).trim() === '') {
            errors.push(`Row ${index + 1}: Missing mandatory Workflow_Code.`);
        }

        // 2. Module
        const modStr = String(step.module || '').trim();
        const matchedMod = ALLOWED_MODULES.find(m => m.toLowerCase() === modStr.toLowerCase());
        if (!matchedMod) {
            warnings.push(`Row ${index + 1}: Module '${modStr}' mapped to fallback '${sanitizeModule(modStr)}'.`);
        }

        // 3. Transaction_Type
        if (!step.transactionType || String(step.transactionType).trim() === '') {
            warnings.push(`Row ${index + 1}: Transaction_Type empty. Defaulted to 'General_Request'.`);
        }

        // 4. Step_No
        const numStep = Number(step.stepNo);
        if (isNaN(numStep) || numStep < 1 || !Number.isInteger(numStep)) {
            errors.push(`Row ${index + 1}: Step_No must be a positive integer >= 1 (got '${step.stepNo}').`);
        }

        // 5. Approver_Type
        const normApproverType = sanitizeApproverType(step.approverType);

        // 6. Foreign Key Validation & Mandates for Approver Targets
        if (normApproverType === 'Specific_Employee') {
            if (!step.approverEmployeeId || String(step.approverEmployeeId).trim() === '') {
                errors.push(`Row ${index + 1}: Approver_Employee_ID is mandatory when Approver_Type is 'Specific_Employee'.`);
            } else if (refData.employees && Array.isArray(refData.employees) && refData.employees.length > 0) {
                const empId = String(step.approverEmployeeId).trim().toUpperCase();
                const exists = refData.employees.some(e => {
                    const id = typeof e === 'string' ? e : (e.id || e.employeeId || e.Employee_ID || e.code);
                    return String(id || '').toUpperCase() === empId;
                });
                if (!exists) {
                    warnings.push(`Row ${index + 1}: Approver Employee '${empId}' not found in active employees directory.`);
                }
            }
        }

        if (normApproverType === 'Role_Based') {
            if (!step.approverRoleCode || String(step.approverRoleCode).trim() === '') {
                errors.push(`Row ${index + 1}: Approver_Role_Code is mandatory when Approver_Type is 'Role_Based'.`);
            } else if (refData.roles && Array.isArray(refData.roles) && refData.roles.length > 0) {
                const roleCode = String(step.approverRoleCode).trim().toUpperCase();
                const exists = refData.roles.some(r => {
                    const rc = typeof r === 'string' ? r : (r.id || r.roleCode || r.Role_Code || r.code);
                    return String(rc || '').toUpperCase() === roleCode;
                });
                if (!exists) {
                    warnings.push(`Row ${index + 1}: Approver Role '${roleCode}' not found in roles directory.`);
                }
            }
        }

        // 7. SLA_Hours
        const numSla = Number(step.slaHours);
        if (isNaN(numSla) || numSla <= 0) {
            warnings.push(`Row ${index + 1}: SLA_Hours should be a positive number. Defaulting to 24.`);
        }

        return {
            isValid: errors.length === 0,
            errors,
            warnings
        };
    }

    /**
     * Validate sequence continuity: Step_No must start at 1 and increase monotonically without gaps
     */
    function validateSequenceContinuity(groupedWorkflows) {
        const continuityErrors = [];

        for (const [wfKey, wf] of Object.entries(groupedWorkflows)) {
            const steps = wf.steps.slice().sort((a, b) => a.stepNo - b.stepNo);

            if (steps.length === 0) {
                continuityErrors.push(`Workflow '${wf.workflowCode}': Contains no approval steps.`);
                continue;
            }

            if (steps[0].stepNo !== 1) {
                continuityErrors.push(`Workflow '${wf.workflowCode}' (${wf.transactionType}): Step sequence must begin at Step 1 (found initial step: ${steps[0].stepNo}).`);
            }

            for (let i = 0; i < steps.length; i++) {
                const expectedStepNo = i + 1;
                if (steps[i].stepNo !== expectedStepNo) {
                    continuityErrors.push(
                        `Workflow '${wf.workflowCode}' (${wf.transactionType}): Broken sequence continuity. Expected step ${expectedStepNo}, found step ${steps[i].stepNo}.`
                    );
                }
            }
        }

        return continuityErrors;
    }

    /**
     * Main Sheet Parser Function
     * 
     * Ingests raw rows (array of objects from XLSX.utils.sheet_to_json),
     * validates all 10 attributes, checks sequence continuity,
     * and compiles both flat step records and hierarchical Firestore documents.
     */
    function parseWorkflowRulesSheet(rawRows, refData = {}) {
        if (!Array.isArray(rawRows) || rawRows.length === 0) {
            return {
                success: false,
                totalRows: 0,
                validRowsCount: 0,
                invalidRowsCount: 0,
                records: [],
                groupedWorkflows: {},
                workflowDocuments: [],
                errors: ['No data rows found in Workflow Rules sheet.'],
                warnings: [],
                metadata: {
                    totalWorkflows: 0,
                    activeWorkflows: 0,
                    modulesCovered: []
                }
            };
        }

        const records = [];
        const globalErrors = [];
        const globalWarnings = [];
        const groupedMap = {};
        const modulesSet = new Set();

        rawRows.forEach((row, idx) => {
            const canonical = mapRowToCanonical(row);

            // Skip empty rows
            const hasData = Object.values(canonical).some(v => v !== undefined && v !== null && String(v).trim() !== '');
            if (!hasData) return;

            const workflowCode = String(canonical.workflowCode || '').trim();
            const moduleName = sanitizeModule(canonical.module);
            const transactionType = String(canonical.transactionType || 'General_Request').trim();
            const rawStepNo = parseInt(canonical.stepNo, 10);
            const stepNo = isNaN(rawStepNo) ? (records.length + 1) : rawStepNo;
            const approverType = sanitizeApproverType(canonical.approverType);
            const approverEmployeeId = canonical.approverEmployeeId ? String(canonical.approverEmployeeId).trim() : null;
            const approverRoleCode = canonical.approverRoleCode ? String(canonical.approverRoleCode).trim() : null;
            const rawSla = parseFloat(canonical.slaHours);
            const slaHours = (!isNaN(rawSla) && rawSla > 0) ? rawSla : 24;
            const isMandatory = parseBoolean(canonical.mandatory, true);
            const isActive = parseBoolean(canonical.active, true);

            const record = {
                id: `${workflowCode}_S${stepNo}`.replace(/[^a-zA-Z0-9_-]/g, '_'),
                workflowCode,
                module: moduleName,
                transactionType,
                stepNo,
                approverType,
                approverEmployeeId: (approverType === 'Specific_Employee') ? approverEmployeeId : null,
                approverRoleCode: (approverType === 'Role_Based') ? approverRoleCode : null,
                slaHours,
                isMandatory,
                isActive,
                rawRowIndex: idx + 1
            };

            const valRes = validateStepRecord(record, idx, refData);
            if (!valRes.isValid) {
                globalErrors.push(...valRes.errors);
            }
            if (valRes.warnings.length > 0) {
                globalWarnings.push(...valRes.warnings);
            }

            records.push(record);
            modulesSet.add(moduleName);

            // Group into hierarchical workflow structures
            const wfKey = `${workflowCode}__${transactionType}`;
            if (!groupedMap[wfKey]) {
                groupedMap[wfKey] = {
                    workflowCode,
                    module: moduleName,
                    transactionType,
                    isActive,
                    steps: []
                };
            }

            // If any step is inactive, or top-level is inactive, record state
            if (!isActive) {
                // keep individual step flag
            }

            groupedMap[wfKey].steps.push({
                stepNo,
                approverType,
                approverEmployeeId: record.approverEmployeeId,
                approverRoleCode: record.approverRoleCode,
                slaHours,
                isMandatory,
                isActive
            });
        });

        // Sort steps in each grouped workflow
        for (const wfKey of Object.keys(groupedMap)) {
            groupedMap[wfKey].steps.sort((a, b) => a.stepNo - b.stepNo);
        }

        // Validate sequence continuity across all workflows
        const continuityErrors = validateSequenceContinuity(groupedMap);
        if (continuityErrors.length > 0) {
            globalErrors.push(...continuityErrors);
        }

        // Prepare finalized Firestore documents: organizations/{orgId}/workflows/{workflowCode}
        const workflowDocuments = Object.values(groupedMap).map(wf => ({
            workflowCode: wf.workflowCode,
            module: wf.module,
            transactionType: wf.transactionType,
            isActive: wf.isActive,
            steps: wf.steps.map(s => ({
                stepNo: s.stepNo,
                approverType: s.approverType,
                approverEmployeeId: s.approverEmployeeId,
                approverRoleCode: s.approverRoleCode,
                slaHours: s.slaHours,
                isMandatory: s.isMandatory
            })),
            totalSteps: wf.steps.length,
            createdAt: 'serverTimestamp()',
            updatedAt: 'serverTimestamp()'
        }));

        const activeCount = workflowDocuments.filter(w => w.isActive).length;

        return {
            success: globalErrors.length === 0,
            totalRows: records.length,
            validRowsCount: records.length - globalErrors.length,
            invalidRowsCount: globalErrors.length,
            records,
            groupedWorkflows: groupedMap,
            workflowDocuments,
            errors: globalErrors,
            warnings: globalWarnings,
            metadata: {
                totalWorkflows: workflowDocuments.length,
                activeWorkflows: activeCount,
                modulesCovered: Array.from(modulesSet)
            }
        };
    }

    /**
     * Helper to detect and extract Workflow Rules sheet from a SheetJS workbook
     */
    function findWorkflowRulesSheet(workbook) {
        if (!workbook || !workbook.SheetNames) return null;
        const regexes = [
            /^(Workflow[_\s]*Rules)/i,
            /^(Workflow[_\s]*Chain)/i,
            /^(Workflow_Rules_Sheet)/i,
            /^(Workflow)/i,
            /^(Workflows)/i,
            /^(Approval[_\s]*Rules)/i,
            /^(Multi[_\s]*Step)/i
        ];

        for (const r of regexes) {
            const match = workbook.SheetNames.find(name => r.test(name));
            if (match) return match;
        }
        return null;
    }

    return {
        parseWorkflowRulesSheet,
        findWorkflowRulesSheet,
        validateStepRecord,
        validateSequenceContinuity,
        mapRowToCanonical,
        parseBoolean,
        sanitizeModule,
        sanitizeApproverType,
        ALLOWED_MODULES,
        ALLOWED_APPROVER_TYPES,
        HEADER_SYNONYMS
    };
}));
