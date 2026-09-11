/**
 * Unified HR Module Contract
 * 
 * Standard contract that every HR module must implement to expose its
 * triggers, conditions, dynamic data resolvers, and action handlers to the
 * Central Unified Automation Engine.
 */

class UnifiedModuleContract {
    /**
     * @param {Object} def
     * @param {string} def.moduleKey - Unique key, e.g. 'onboarding', 'leave', 'exit', 'payroll', 'statutory'
     * @param {string} def.moduleName - Human readable name
     * @param {string} def.description - Module description
     * @param {Array<Object>} def.triggers - Array of trigger definitions
     * @param {Array<Object>} def.conditions - Array of condition field definitions
     * @param {Object} def.dataResolvers - Map of entityType -> async (entityId, context) => entityData
     * @param {Object} def.actions - Map of actionKey -> async (params, context) => result
     */
    constructor(def) {
        this.validateDefinition(def);
        this.moduleKey = def.moduleKey;
        this.moduleName = def.moduleName;
        this.description = def.description || '';
        this.triggers = def.triggers || [];
        this.conditions = def.conditions || [];
        this.dataResolvers = def.dataResolvers || {};
        this.actions = def.actions || {};
    }

    validateDefinition(def) {
        if (!def || typeof def !== 'object') {
            throw new Error('Module definition must be an object');
        }
        if (!def.moduleKey || typeof def.moduleKey !== 'string') {
            throw new Error('Module definition missing valid string moduleKey');
        }
        if (!def.moduleName || typeof def.moduleName !== 'string') {
            throw new Error('Module definition missing valid string moduleName');
        }
        if (def.triggers && !Array.isArray(def.triggers)) {
            throw new Error(`Module ${def.moduleKey}: triggers must be an array`);
        }
        if (def.conditions && !Array.isArray(def.conditions)) {
            throw new Error(`Module ${def.moduleKey}: conditions must be an array`);
        }
        if (def.actions && typeof def.actions !== 'object') {
            throw new Error(`Module ${def.moduleKey}: actions must be an object map`);
        }
    }

    /**
     * Helper to get trigger by name
     */
    getTrigger(triggerName) {
        return this.triggers.find(t => t.name === triggerName);
    }

    /**
     * Helper to execute action
     */
    async executeAction(actionKey, params, context = {}) {
        const handler = this.actions[actionKey];
        if (!handler || typeof handler !== 'function') {
            throw new Error(`Action '${actionKey}' is not supported by module '${this.moduleKey}'`);
        }
        return await handler(params, context);
    }

    /**
     * Helper to resolve entity data
     */
    async resolveData(entityType, entityId, context = {}) {
        const resolver = this.dataResolvers[entityType];
        if (!resolver || typeof resolver !== 'function') {
            return null;
        }
        return await resolver(entityId, context);
    }
}

module.exports = UnifiedModuleContract;
