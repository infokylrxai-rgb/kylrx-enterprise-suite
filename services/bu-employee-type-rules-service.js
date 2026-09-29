/**
 * Business Unit by Employee Type Rules Service (PRD Section 10)
 * Manages configurable mappings between Business Units and allowed Employee Types
 * Cloud Firestore Collection: bu_employee_type_rules/{ruleId}
 */

const logger = require('../utils/logger');

// Canonical Employee Types aligned with 'Employee Type' sheet:
// Category_Code, Category_Name, Employment_Type, Worker_Type
const CANONICAL_EMPLOYEE_TYPES = [
    {
        code: 'FULL_TIME',
        name: 'Full-Time Regular',
        categoryCode: 'CAT_FT',
        employmentType: 'Full-Time',
        workerType: 'Permanent'
    },
    {
        code: 'CONTRACTOR',
        name: 'Contractor / TVC',
        categoryCode: 'CAT_CON',
        employmentType: 'Contract',
        workerType: 'Contingent'
    },
    {
        code: 'INTERN',
        name: 'Intern / Apprentice',
        categoryCode: 'CAT_INT',
        employmentType: 'Internship',
        workerType: 'Trainee'
    },
    {
        code: 'CONSULTANT',
        name: 'Consultant / Specialist',
        categoryCode: 'CAT_CNS',
        employmentType: 'Consulting',
        workerType: 'Professional'
    },
    {
        code: 'EXECUTIVE',
        name: 'Executive Leadership',
        categoryCode: 'CAT_EXE',
        employmentType: 'Full-Time',
        workerType: 'Officer'
    }
];

// Default Business Unit Rules aligned with 'Business Unit' sheet:
// Business_Unit_Code, Business_Unit_Name, Head_Employee_ID, Active
const DEFAULT_BU_RULES = [
    {
        ruleId: 'rule_bu_eng',
        businessUnitCode: 'BU_ENG',
        businessUnitName: 'Core Engineering & Technology',
        allowedEmployeeTypes: ['FULL_TIME', 'INTERN', 'CONTRACTOR'],
        headEmployeeId: 'EMP0001',
        isActive: true
    },
    {
        ruleId: 'rule_bu_tech',
        businessUnitCode: 'BU-TECH',
        businessUnitName: 'Technology & Product Engineering',
        allowedEmployeeTypes: ['FULL_TIME', 'INTERN', 'CONTRACTOR'],
        headEmployeeId: 'EMP0001',
        isActive: true
    },
    {
        ruleId: 'rule_bu_ops',
        businessUnitCode: 'BU-OPS',
        businessUnitName: 'Global Operations & Customer Success',
        allowedEmployeeTypes: ['FULL_TIME', 'CONTRACTOR'],
        headEmployeeId: 'EMP0002',
        isActive: true
    },
    {
        ruleId: 'rule_bu_corp',
        businessUnitCode: 'BU-CORP',
        businessUnitName: 'Corporate Finance & HR',
        allowedEmployeeTypes: ['FULL_TIME', 'CONSULTANT'],
        headEmployeeId: 'EMP0003',
        isActive: true
    },
    {
        ruleId: 'rule_bu_exec',
        businessUnitCode: 'BU-EXEC',
        businessUnitName: 'Executive Leadership & Strategy',
        allowedEmployeeTypes: ['EXECUTIVE', 'FULL_TIME'],
        headEmployeeId: 'EMP0004',
        isActive: true
    },
    {
        ruleId: 'rule_bu_sales',
        businessUnitCode: 'BU-SALES',
        businessUnitName: 'Enterprise Sales & Partnerships',
        allowedEmployeeTypes: ['FULL_TIME', 'CONTRACTOR', 'CONSULTANT'],
        headEmployeeId: 'EMP0005',
        isActive: true
    }
];

class BuEmployeeTypeRulesService {
    constructor() {
        this.rules = new Map();
        this._initDefaultRules();
    }

    _initDefaultRules() {
        DEFAULT_BU_RULES.forEach(r => {
            this.rules.set(r.businessUnitCode, { ...r, updatedAt: new Date().toISOString() });
        });
    }

    /**
     * Get all active business unit rules
     */
    getAllRules() {
        return Array.from(this.rules.values());
    }

    /**
     * Get all canonical employee types
     */
    getEmployeeTypes() {
        return [...CANONICAL_EMPLOYEE_TYPES];
    }

    /**
     * Get rule by Business Unit Code
     */
    getRuleByCode(buCode) {
        if (!buCode) return null;
        const normalized = buCode.trim().toUpperCase();
        return this.rules.get(normalized) || null;
    }

    /**
     * Get list of business units allowed for a specific employee type
     */
    getAllowedBusinessUnits(employeeType) {
        if (!employeeType) {
            return this.getAllRules().filter(r => r.isActive);
        }
        const normalizedType = employeeType.trim().toUpperCase();
        return this.getAllRules().filter(r => {
            if (!r.isActive) return false;
            return Array.isArray(r.allowedEmployeeTypes) &&
                   r.allowedEmployeeTypes.map(t => t.toUpperCase()).includes(normalizedType);
        });
    }

    /**
     * Validate whether a Business Unit and Employee Type pair is permitted
     */
    isCombinationValid(buCode, employeeType) {
        if (!buCode || !employeeType) {
            return { valid: false, error: 'Both Business Unit and Employee Type are required for validation.' };
        }
        const normalizedBU = buCode.trim().toUpperCase();
        const normalizedType = employeeType.trim().toUpperCase();

        const rule = this.rules.get(normalizedBU);
        if (!rule) {
            // Unknown BU: return error to prevent unmapped combinations
            return {
                valid: false,
                error: `Business Unit '${buCode}' is not recognized in configured organizational rules.`
            };
        }

        if (!rule.isActive) {
            return {
                valid: false,
                error: `Business Unit '${rule.businessUnitName}' (${buCode}) is currently deactivated.`
            };
        }

        const allowed = (rule.allowedEmployeeTypes || []).map(t => t.toUpperCase());
        if (!allowed.includes(normalizedType)) {
            const allowedLabels = allowed.map(t => {
                const found = CANONICAL_EMPLOYEE_TYPES.find(c => c.code === t);
                return found ? found.name : t;
            }).join(', ');

            return {
                valid: false,
                error: `Business Unit '${rule.businessUnitName}' (${buCode}) does not permit '${employeeType}'. Allowed employee types: ${allowedLabels || 'None'}.`
            };
        }

        return { valid: true };
    }

    /**
     * Upsert a Business Unit Rule
     */
    saveRule(ruleData, actor = 'Super Admin') {
        if (!ruleData.businessUnitCode) {
            throw new Error('businessUnitCode is required.');
        }

        const normalizedCode = ruleData.businessUnitCode.trim().toUpperCase();
        const ruleId = ruleData.ruleId || `rule_${normalizedCode.toLowerCase().replace(/[^a-z0-9]/g, '_')}`;

        // Ensure allowedEmployeeTypes contains valid uppercase codes
        const validCodes = CANONICAL_EMPLOYEE_TYPES.map(t => t.code);
        const allowedTypes = Array.isArray(ruleData.allowedEmployeeTypes)
            ? ruleData.allowedEmployeeTypes
                .map(t => t.trim().toUpperCase())
                .filter(t => validCodes.includes(t))
            : ['FULL_TIME'];

        const existing = this.rules.get(normalizedCode) || {};
        const record = {
            ruleId,
            businessUnitCode: normalizedCode,
            businessUnitName: ruleData.businessUnitName || existing.businessUnitName || normalizedCode,
            allowedEmployeeTypes: allowedTypes,
            headEmployeeId: ruleData.headEmployeeId || existing.headEmployeeId || '',
            isActive: ruleData.isActive !== undefined ? Boolean(ruleData.isActive) : true,
            updatedAt: new Date().toISOString(),
            updatedBy: actor
        };

        this.rules.set(normalizedCode, record);
        logger.info(`[BURulesService] Saved rule for '${normalizedCode}' (${allowedTypes.length} allowed types).`);
        return record;
    }

    /**
     * Reset rules to canonical defaults
     */
    resetDefaults() {
        this.rules.clear();
        this._initDefaultRules();
        logger.info('[BURulesService] Reset rules to canonical defaults.');
        return this.getAllRules();
    }
}

module.exports = new BuEmployeeTypeRulesService();
