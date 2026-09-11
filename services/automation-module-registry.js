const logger = require('../utils/logger');
const UnifiedModuleContract = require('./unified-module-contract');

/**
 * Central Automation Module Registry
 * 
 * Singleton repository holding all registered HR module triggers, conditions,
 * data resolvers, and action handlers.
 */
class AutomationModuleRegistry {
    constructor() {
        this.modules = new Map();
        this.triggerIndex = new Map(); // triggerName -> moduleKey
        this.actionIndex = new Map();  // actionKey -> moduleKey
    }

    /**
     * Register a module adapter
     * @param {UnifiedModuleContract|Object} moduleDef 
     */
    registerModule(moduleDef) {
        const contract = moduleDef instanceof UnifiedModuleContract 
            ? moduleDef 
            : new UnifiedModuleContract(moduleDef);

        const key = contract.moduleKey;
        if (this.modules.has(key)) {
            logger.warn(`[ModuleRegistry] Overwriting existing registration for module: ${key}`);
        }

        this.modules.set(key, contract);

        // Index triggers
        contract.triggers.forEach(t => {
            if (this.triggerIndex.has(t.name) && this.triggerIndex.get(t.name) !== key) {
                logger.warn(`[ModuleRegistry] Trigger collision: '${t.name}' registered by multiple modules`);
            }
            this.triggerIndex.set(t.name, key);
        });

        // Index actions
        Object.keys(contract.actions).forEach(act => {
            this.actionIndex.set(act, key);
        });

        logger.info(`[ModuleRegistry] Successfully registered module: ${contract.moduleName} (${key}) with ${contract.triggers.length} triggers, ${Object.keys(contract.actions).length} actions.`);
        return contract;
    }

    /**
     * Get module by key
     */
    getModule(moduleKey) {
        return this.modules.get(moduleKey);
    }

    /**
     * Find module that handles a given trigger
     */
    getModuleForTrigger(triggerName) {
        let moduleKey = this.triggerIndex.get(triggerName);
        if (!moduleKey) {
            for (const [k, mod] of this.modules.entries()) {
                if (mod.triggers && mod.triggers.some(t => t.name === triggerName)) {
                    this.triggerIndex.set(triggerName, k);
                    moduleKey = k;
                    break;
                }
            }
        }
        return moduleKey ? this.modules.get(moduleKey) : null;
    }

    /**
     * Find module that handles an action
     */
    getModuleForAction(actionKey) {
        let moduleKey = this.actionIndex.get(actionKey);
        if (!moduleKey) {
            for (const [k, mod] of this.modules.entries()) {
                if (mod.actions && mod.actions[actionKey]) {
                    this.actionIndex.set(actionKey, k);
                    moduleKey = k;
                    break;
                }
            }
        }
        return moduleKey ? this.modules.get(moduleKey) : null;
    }

    /**
     * Execute an action across any registered module
     */
    async executeAction(actionKey, params = {}, context = {}) {
        const module = this.getModuleForAction(actionKey);
        if (!module) {
            throw new Error(`[ModuleRegistry] No registered HR module handles action: '${actionKey}'`);
        }
        return await module.executeAction(actionKey, params, context);
    }

    /**
     * Resolve contextual data from the appropriate module
     */
    async resolveData(moduleKey, entityType, entityId, context = {}) {
        const module = this.modules.get(moduleKey);
        if (!module) {
            return null;
        }
        return await module.resolveData(entityType, entityId, context);
    }

    /**
     * Return comprehensive catalog of all modules, triggers, conditions, and actions
     */
    getSchemaCatalog() {
        const catalog = [];
        for (const [key, mod] of this.modules.entries()) {
            catalog.push({
                moduleKey: key,
                moduleName: mod.moduleName,
                description: mod.description,
                triggers: mod.triggers.map(t => ({
                    name: t.name,
                    label: t.label,
                    description: t.description,
                    samplePayload: t.samplePayload || {},
                    schema: t.schema || {}
                })),
                conditions: mod.conditions.map(c => ({
                    field: c.field,
                    label: c.label,
                    type: c.type,
                    operators: c.operators || ['==', '!=', '>', '<', '>=', '<=', 'in', 'contains'],
                    allowedValues: c.allowedValues || null
                })),
                actions: Object.keys(mod.actions).map(actionKey => ({
                    actionKey,
                    description: (mod.actions[actionKey] && mod.actions[actionKey].description) || `Execute ${actionKey}`
                }))
            });
        }
        return catalog;
    }

    /**
     * Reset registry (useful for testing)
     */
    reset() {
        this.modules.clear();
        this.triggerIndex.clear();
        this.actionIndex.clear();
    }
}

const globalModuleRegistry = new AutomationModuleRegistry();
module.exports = globalModuleRegistry;
