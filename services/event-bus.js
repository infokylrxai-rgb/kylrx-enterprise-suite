const EventEmitter = require('events');
const crypto = require('crypto');
const logger = require('../utils/logger');

class EventBus extends EventEmitter {
    constructor() {
        super();
        // Increase max listeners if needed, default is 10
        this.setMaxListeners(50);
    }

    /**
     * Standardized event emission
     * @param {string} eventName - Name of the event (e.g., 'resignation.submitted')
     * @param {string} entityId - ID of the entity involved (e.g., employeeId)
     * @param {string} entityType - Type of the entity (e.g., 'employee')
     * @param {Object} payload - Additional event data
     * @returns {string} eventId - The generated unique ID for this event
     */
    emitEvent(eventName, entityId, entityType, payload = {}) {
        const eventId = crypto.randomUUID();
        const eventData = {
            eventId,
            eventName,
            entityId,
            entityType,
            payload,
            timestamp: new Date().toISOString()
        };

        logger.info(`[EventBus] Emitting event: ${eventName} (Entity: ${entityType}/${entityId})`);
        
        // Emit locally for our automation engine to pick up
        this.emit(eventName, eventData);
        // Also emit a catch-all event for debugging or generic auditing if needed
        this.emit('*', eventData);

        return eventId;
    }
}

// Export as a singleton
const eventBus = new EventBus();
module.exports = eventBus;
