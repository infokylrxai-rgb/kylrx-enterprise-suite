const crypto = require('crypto');
const { db, rawCollection } = require('../config/firebase');
const { confirmedWrite } = require('../config/firestore-write');
const logger = require('../utils/logger');

/**
 * Per-organization, Firestore-backed copies of an in-memory engine.
 *
 * The template engines keep their state in Maps (built-in templates plus whatever users
 * create). This store gives every organization its own engine instance, loads that
 * organization's saved items from Firestore into it, and after each change writes the items
 * that differ from what Firestore holds (confirmed writes). If a save fails, the cached
 * engine is dropped so the next request reloads what Firestore actually has.
 *
 * Each "map" describes one engine Map:
 *   field       engine property holding the Map (e.g. 'templates')
 *   collection  Firestore collection, one document per item: { orgId, itemId, data, updatedAt }
 *   idOf(item)  the item's id
 *   put(engine, item)  puts a loaded item into the engine (e.g. under both id and key)
 */
class TenantEngineStore {
    constructor({ name, createEngine, maps, maxItems = 2000 }) {
        this.name = name;
        this.createEngine = createEngine;
        this.maps = maps;
        this.maxItems = maxItems;
        this.cache = new Map();   // orgId -> Promise<{ engine, saved: Map<collection, Map<id, hash>> }>
        this.queues = new Map();  // orgId -> tail of that organization's request queue
    }

    static hash(item) {
        return crypto.createHash('sha1').update(JSON.stringify(item)).digest('hex');
    }

    static docId(orgId, itemId) {
        return `${orgId}__${String(itemId).replace(/\//g, '_')}`.slice(0, 1400);
    }

    /** Distinct items of an engine Map (an item may be stored under several keys) */
    itemsOf(engine, map) {
        const items = new Map();
        for (const item of engine[map.field].values()) {
            const id = map.idOf(item);
            if (id !== undefined && id !== null) items.set(String(id), item);
        }
        return items;
    }

    async load(orgId) {
        const engine = this.createEngine();
        const saved = new Map();
        for (const map of this.maps) {
            // Built-in items as they are before this organization's changes
            const baseline = new Map([...this.itemsOf(engine, map)].map(([id, item]) => [id, TenantEngineStore.hash(item)]));
            const snap = await rawCollection(map.collection).where('orgId', '==', orgId).limit(this.maxItems).get();
            const hashes = new Map(baseline);
            snap.docs.forEach(doc => {
                const { data } = doc.data();
                if (!data) return;
                map.put(engine, data);
                hashes.set(String(map.idOf(data)), TenantEngineStore.hash(data));
            });
            saved.set(map.collection, hashes);
        }
        return { engine, saved };
    }

    state(orgId) {
        if (!this.cache.has(orgId)) {
            const loading = this.load(orgId).catch(err => { this.cache.delete(orgId); throw err; });
            this.cache.set(orgId, loading);
        }
        return this.cache.get(orgId);
    }

    /** Runs fn(engine) for reading; no save */
    async read(orgId, fn) {
        const { engine } = await this.state(orgId);
        return fn(engine);
    }

    /**
     * Runs fn(engine) and saves what it changed. Requests of one organization run one at a
     * time, so a change and its save are never interleaved with another change.
     */
    change(orgId, fn) {
        const previous = this.queues.get(orgId) || Promise.resolve();
        const run = previous.catch(() => {}).then(async () => {
            const state = await this.state(orgId);
            try {
                const result = await fn(state.engine);
                await this.save(orgId, state);
                return result;
            } catch (err) {
                // The engine may hold a change that was not saved: reload from Firestore next time
                this.cache.delete(orgId);
                throw err;
            }
        });
        this.queues.set(orgId, run);
        return run;
    }

    async save(orgId, state) {
        const writes = [];
        for (const map of this.maps) {
            const hashes = state.saved.get(map.collection);
            for (const [id, item] of this.itemsOf(state.engine, map)) {
                // JSON round trip: plain data only (Firestore rejects undefined and class instances)
                const data = JSON.parse(JSON.stringify(item));
                const hash = TenantEngineStore.hash(data);
                if (hashes.get(id) === hash) continue;
                writes.push({ map, id, data, hash });
            }
        }
        if (!writes.length) return 0;

        const now = new Date();
        for (let i = 0; i < writes.length; i += 400) {
            const batch = db.batch();
            writes.slice(i, i + 400).forEach(w => {
                batch.set(rawCollection(w.map.collection).doc(TenantEngineStore.docId(orgId, w.id)), {
                    orgId, itemId: w.id, data: w.data, updatedAt: now
                });
            });
            await confirmedWrite(() => batch.commit());
        }
        writes.forEach(w => state.saved.get(w.map.collection).set(w.id, w.hash));
        logger.info(`[${this.name}] Saved ${writes.length} change(s) for ${orgId} to Firestore.`);
        return writes.length;
    }
}

module.exports = TenantEngineStore;
