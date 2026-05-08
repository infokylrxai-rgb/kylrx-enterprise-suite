/**
 * Manager AI Configuration Logic
 * Handles department-specific AI/ML thresholds and modules
 */

export const AI_MODULES = [
    { id: 'performance', name: 'Efficiency Analysis', desc: 'Predicts workforce output trends' },
    { id: 'risk', name: 'Burnout Detection', desc: 'Identifies employees at high risk of burnout' },
    { id: 'security', name: 'Anomaly Detection', desc: 'Flags unusual application access patterns' }
];

export class AIConfigManager {
    constructor() {
        this.config = {
            thresholds: {
                productivity: 75,
                burnout: 80,
                idle: 15
            },
            activeModules: ['performance']
        };
    }

    updateThreshold(key, value) {
        this.config.thresholds[key] = value;
    }

    toggleModule(moduleId) {
        const index = this.config.activeModules.indexOf(moduleId);
        if (index > -1) {
            this.config.activeModules.splice(index, 1);
        } else {
            this.config.activeModules.push(moduleId);
        }
    }

    getExportableConfig() {
        return { ...this.config };
    }
}
