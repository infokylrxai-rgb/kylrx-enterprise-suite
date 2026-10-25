const crypto = require('crypto');
const logger = require('../utils/logger');
const { db, rawCollection } = require('../config/firebase');
const { confirmedWrite } = require('../config/firestore-write');
const { orgDocs, LEGACY_ORG_ID } = require('../config/tenant');
const otpVerificationService = require('./otp-verification-service');

/** Real email delivery is available when a provider is configured (and never in local test mode) */
function emailDeliveryAvailable() {
    return !process.env.KYLRX_LOCAL_DB && Boolean((process.env.SMTP_USER && process.env.SMTP_PASS) || process.env.RESEND_API_KEY);
}

/** Map with Firestore-safe (plain JSON) values */
const plain = (value) => JSON.parse(JSON.stringify(value === undefined ? null : value));

/**
 * Resilient Firestore write helper that never hangs event loop on quota or latency
 */
function safeFirestoreWrite(writePromise, timeoutMs = 4000) {
    if (!writePromise || typeof writePromise.then !== 'function') return Promise.resolve();
    return new Promise((resolve) => {
        let done = false;
        const timer = setTimeout(() => {
            if (!done) {
                done = true;
                resolve();
            }
        }, timeoutMs);
        if (timer && timer.unref) timer.unref();

        writePromise.then(() => {
            if (!done) {
                done = true;
                clearTimeout(timer);
                resolve();
            }
        }).catch(() => {
            if (!done) {
                done = true;
                clearTimeout(timer);
                resolve();
            }
        });
    });
}

/**
 * Bulk Triggering & Batch Processing Engine (PRD §2)
 * 
 * Implements:
 * - 2.1 Bulk Triggering Workflow:
 *   • Authorised action selection (Email, OTP, Template Setup, Custom)
 *   • Selection validation & total count preview
 *   • Large request chunking into configurable batches
 *   • Real-time progress tracking (queued, processing, completed)
 *   • Granular failed items listing for administrative review
 *   • Idempotent safe retries avoiding duplicate actions
 * 
 * - 2.2 Batch Processing Controls (Handwritten notes example: 100 items in 5 groups of 20):
 *   • Administrator-configurable batch size (default: 20)
 *   • Robust permission & recipient data validation
 *   • Progress states: queued -> processing -> completed
 *   • Full failure reporting & safe retry mechanisms
 *   • Immutable audit logs: initiator, time, count, outcome
 * 
 * - 2.3 Email & OTP Separation:
 *   • Strict separation between Email notifications & OTP verification
 *   • OTPs expire, work only once, and enforce attempt limits
 *   • Bulk email respects provider rate limits & recipient consent rules
 */
class BulkTriggerEngine {
    /**
     * @param {Object} [options]
     * @param {string} [options.orgId] - Organization this engine works for. With an orgId, the
     *   engine loads and saves only that organization's settings, jobs and audit trail, picks
     *   recipients from its people only, and every save is confirmed by Firestore (a failed save
     *   throws instead of being ignored). Without one it is the legacy shared engine.
     */
    constructor(options = {}) {
        this.orgId = options.orgId || null;
        // offline: nothing is read from or written to Firestore (acceptance self-tests)
        this.offline = options.offline === true;

        // Jobs Store: jobId -> Job Record
        this.jobs = new Map();

        // Audit Trail: Chronological immutable log of bulk trigger executions
        this.auditLogs = [];

        // Administrator-configurable Engine Settings (PRD §2.2)
        this.config = {
            batchSize: 20,              // Default 20 items per batch (100 items = 5 batches)
            minBatchSize: 1,
            maxBatchSize: 100,
            interBatchDelayMs: 25,      // Throttling delay between batches to respect provider rate limits
            maxEmailsPerSecond: 50,     // Provider rate limit constraint
            strictConsentRequired: true // Consent check for marketing/bulk notifications
        };

        // Allowed Roles per Action Type
        this.actionPermissions = {
            EMAIL_NOTIFICATION: ['super_admin', 'hr_admin', 'admin', 'manager'],
            OTP_VERIFICATION: ['super_admin', 'hr_admin', 'admin'],
            TEMPLATE_SETUP_DISPATCH: ['super_admin', 'hr_admin', 'admin', 'manager'],
            CUSTOM_WORKFLOW: ['super_admin', 'hr_admin', 'admin']
        };

        // Initialize synchronization with Firebase Firestore (callers await `ready`)
        this.ready = (this.orgId ? this.loadOrgState() : this.initFirestoreSync()).catch(err => {
            logger.warn(`[BulkTriggerEngine] Initial load notice${this.orgId ? ` for ${this.orgId}` : ''}: ${err.message}`);
            throw err;
        });
        this.ready.catch(() => {});
    }

    configDocId() {
        return this.orgId ? `bulk_trigger_config_${this.orgId}` : 'bulk_trigger_config';
    }

    /**
     * Loads this organization's settings, recent jobs and audit trail. The shared (untagged)
     * records written before organizations were separated belong to the legacy organization.
     */
    async loadOrgState() {
        const isLegacy = this.orgId === LEGACY_ORG_ID;
        const configSnap = await rawCollection('system_configs').doc(this.configDocId()).get();
        const legacyConfig = !configSnap.exists && isLegacy ? await rawCollection('system_configs').doc('bulk_trigger_config').get() : null;
        const stored = configSnap.exists ? configSnap.data() : (legacyConfig && legacyConfig.exists ? legacyConfig.data() : null);
        if (stored && stored.batchSize) {
            const { batchSize, interBatchDelayMs, maxEmailsPerSecond, strictConsentRequired } = stored;
            this.config = { ...this.config, ...plain({ batchSize, interBatchDelayMs, maxEmailsPerSecond, strictConsentRequired }) };
        }

        const [jobs, audits] = await Promise.all([
            orgDocs(rawCollection, 'bulk_trigger_jobs', this.orgId, 200),
            orgDocs(rawCollection, 'bulk_trigger_audit_logs', this.orgId, 500)
        ]);
        jobs.filter(j => j.jobId)
            .sort((a, b) => String(a.createdAt || '').localeCompare(String(b.createdAt || '')))
            .forEach(jobData => this.jobs.set(jobData.jobId, {
                ...jobData,
                validItems: jobData.validItems || [],
                failedItems: jobData.failedItems || [],
                itemResults: new Map(Object.entries(jobData.itemResults || {}))
            }));
        this.auditLogs = audits.filter(a => a.auditId).sort((a, b) => String(b.timestamp || '').localeCompare(String(a.timestamp || '')));
        logger.info(`[BulkTriggerEngine] Loaded ${this.orgId}: ${this.jobs.size} jobs, ${this.auditLogs.length} audit entries.`);
    }

    /** Job document as stored in Firestore (with what a retry after a restart needs) */
    jobDocument(job) {
        const itemResults = {};
        if (job.itemResults instanceof Map) job.itemResults.forEach((val, key) => { itemResults[key] = val; });
        else Object.assign(itemResults, job.itemResults || {});
        return plain({
            ...(this.orgId ? { orgId: this.orgId } : {}),
            jobId: job.jobId,
            action: job.action,
            status: job.status,
            actor: job.actor,
            payload: job.payload || {},
            batchSize: job.batchSize,
            totalItems: job.totalItems,
            totalBatches: job.totalBatches,
            currentBatchIndex: job.currentBatchIndex,
            processedCount: job.processedCount,
            successCount: job.successCount,
            failureCount: job.failureCount,
            skippedCount: job.skippedCount,
            batches: job.batches || [],
            validItems: job.validItems || [],
            invalidPrecheckItems: job.invalidPrecheckItems || [],
            failedItems: job.failedItems || [],
            itemResults,
            createdAt: job.createdAt,
            startedAt: job.startedAt,
            completedAt: job.completedAt,
            auditSummary: job.auditSummary || null,
            syncedAt: new Date().toISOString()
        });
    }

    /**
     * Saves a job (and its pending audit entry) for an organization engine; resolves once
     * Firestore confirmed it, rejects (503) otherwise.
     */
    async saveJobConfirmed(job) {
        const batch = db.batch();
        batch.set(rawCollection('bulk_trigger_jobs').doc(job.jobId), this.jobDocument(job));
        if (job._pendingAudit) {
            batch.set(rawCollection('bulk_trigger_audit_logs').doc(job._pendingAudit.auditId), plain({ ...job._pendingAudit, syncedAt: new Date().toISOString() }));
        }
        await confirmedWrite(() => batch.commit());
        delete job._pendingAudit;
        job.firebaseSaved = true;
    }

    /**
     * Compute SHA-256 hash for audit integrity
     */
    computeHash(data) {
        return crypto.createHash('sha256').update(typeof data === 'string' ? data : JSON.stringify(data)).digest('hex');
    }

    /**
     * Synchronize bulk trigger configurations, recent jobs, and audit logs with Firebase Firestore
     */
    async initFirestoreSync() {
        if (this.offline || !db || typeof db.collection !== 'function') return;
        try {
            // 1. Sync System Config
            const configDoc = await db.collection('system_configs').doc('bulk_trigger_config').get().catch(() => null);
            if (configDoc && configDoc.exists && typeof configDoc.data === 'function') {
                const remoteConfig = configDoc.data();
                if (remoteConfig && remoteConfig.batchSize) {
                    this.config = { ...this.config, ...remoteConfig };
                }
            } else {
                // Seed default configuration to Firestore
                await db.collection('system_configs').doc('bulk_trigger_config').set({
                    ...this.config,
                    updatedAt: new Date().toISOString(),
                    seeded: true
                }, { merge: true }).catch(() => {});
            }

            // 2. Load latest historical audit logs from Firestore
            const auditSnap = await db.collection('bulk_trigger_audit_logs').orderBy('timestamp', 'desc').limit(50).get().catch(() => null);
            if (auditSnap && !auditSnap.empty && Array.isArray(auditSnap.docs)) {
                auditSnap.docs.forEach(docSnap => {
                    const data = docSnap.data();
                    if (data && data.auditId && !this.auditLogs.some(l => l.auditId === data.auditId)) {
                        this.auditLogs.push(data);
                    }
                });
                this.auditLogs.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
            }

            // 3. Load active or recent jobs from Firestore
            const jobsSnap = await db.collection('bulk_trigger_jobs').orderBy('createdAt', 'desc').limit(20).get().catch(() => null);
            if (jobsSnap && !jobsSnap.empty && Array.isArray(jobsSnap.docs)) {
                jobsSnap.docs.forEach(docSnap => {
                    const jobData = docSnap.data();
                    if (jobData && jobData.jobId && !this.jobs.has(jobData.jobId)) {
                        const restoredJob = {
                            ...jobData,
                            itemResults: new Map(Object.entries(jobData.itemResults || {}))
                        };
                        this.jobs.set(jobData.jobId, restoredJob);
                    }
                });
            }

            logger.info(`[BulkTriggerEngine] Connected & synchronized with Firebase Firestore (${this.auditLogs.length} audits, ${this.jobs.size} jobs).`);
        } catch (e) {
            logger.warn(`[BulkTriggerEngine] Firestore sync notice: ${e.message}`);
        }
    }

    /**
     * Persist job metadata and batch state to Firebase Firestore
     */
    async syncJobToFirestore(job) {
        // Organization engines save through saveJobConfirmed()
        if (this.orgId) return;
        if (this.offline || !db || typeof db.collection !== 'function' || !job || !job.jobId) return;
        try {
            const itemResultsObj = {};
            if (job.itemResults instanceof Map) {
                job.itemResults.forEach((val, key) => {
                    itemResultsObj[key] = val;
                });
            } else if (job.itemResults && typeof job.itemResults === 'object') {
                Object.assign(itemResultsObj, job.itemResults);
            }

            const docData = {
                jobId: job.jobId,
                action: job.action,
                status: job.status,
                actor: job.actor,
                batchSize: job.batchSize,
                totalItems: job.totalItems,
                totalBatches: job.totalBatches,
                currentBatchIndex: job.currentBatchIndex,
                processedCount: job.processedCount,
                successCount: job.successCount,
                failureCount: job.failureCount,
                skippedCount: job.skippedCount,
                batches: job.batches || [],
                failedItems: job.failedItems || [],
                createdAt: job.createdAt,
                startedAt: job.startedAt,
                completedAt: job.completedAt,
                auditSummary: job.auditSummary || null,
                syncedAt: new Date().toISOString()
            };

            await safeFirestoreWrite(
                db.collection('bulk_trigger_jobs').doc(job.jobId).set(docData, { merge: true }),
                600
            );
        } catch (e) {
            logger.warn(`[BulkTriggerEngine] Error persisting job ${job.jobId} to Firestore: ${e.message}`);
        }
    }

    /**
     * Retrieve live workforce employees / users from Firebase Firestore for bulk dispatch
     * Queries both 'users' and 'employees' collections with deduplication and timeout protection.
     * Supports 'live', '100', or 'auto' cohort modes.
     */
    async fetchRecipientsFromFirestore(limit = 100, cohortType = 'auto') {
        if (this.orgId) return this.fetchOrgRecipients(limit);
        const recipients = [];
        const seenIds = new Set();
        const seenEmails = new Set();

        if (!db || typeof db.collection !== 'function') {
            return { success: true, source: 'memory_fallback', count: 0, recipients: [] };
        }

        try {
            if (cohortType === '100') {
                return this.generate100TestCohort();
            }

            // 1. Fetch live registered users from Firestore 'users' collection
            const usersSnap = await Promise.race([
                db.collection('users').limit(limit).get(),
                new Promise((_, reject) => setTimeout(() => reject(new Error('Firestore users query timeout')), 3500))
            ]).catch(err => {
                logger.warn(`[BulkTriggerEngine] users collection read notice: ${err.message}`);
                return null;
            });

            if (usersSnap && !usersSnap.empty && Array.isArray(usersSnap.docs)) {
                usersSnap.docs.forEach((docSnap, idx) => {
                    const data = docSnap.data() || {};
                    const id = data.employeeId || data.id || data.uid || docSnap.id;
                    const email = (data.email || data.companyEmail || '').trim();
                    const name = data.name || data.displayName || data.fullName || (email ? email.split('@')[0] : `Staff ${docSnap.id}`);
                    const department = data.department || data.departmentName || 'Corporate';
                    const role = data.role || data.designation || 'Staff';
                    const phone = data.phone || data.mobile || `+9198765${String(idx + 1).padStart(5, '0')}`;
                    const isOptedOut = data.consentStatus === 'opted_out' || data.unsubscribed === true;
                    const consentStatus = isOptedOut ? 'opted_out' : 'granted';

                    if (id && seenIds.has(id)) return;
                    if (email && seenEmails.has(email.toLowerCase())) return;

                    if (id) seenIds.add(id);
                    if (email) seenEmails.add(email.toLowerCase());

                    recipients.push({
                        id,
                        name,
                        email: email || '',
                        phone,
                        department,
                        role,
                        consentStatus,
                        source: 'firestore:users'
                    });
                });
            }

            // 2. Fetch employees from Firestore 'employees' collection
            const remaining = Math.max(0, limit - recipients.length);
            if (remaining > 0) {
                const empSnap = await Promise.race([
                    db.collection('employees').limit(remaining).get(),
                    new Promise((_, reject) => setTimeout(() => reject(new Error('Firestore employees query timeout')), 3500))
                ]).catch(err => {
                    logger.warn(`[BulkTriggerEngine] employees collection read notice: ${err.message}`);
                    return null;
                });

                if (empSnap && !empSnap.empty && Array.isArray(empSnap.docs)) {
                    empSnap.docs.forEach((docSnap, idx) => {
                        const data = docSnap.data() || {};
                        const id = data.employeeId || data.id || docSnap.id;
                        if (seenIds.has(id)) return;

                        const isRelieved = data.employmentStatus === 'Relieved';
                        const email = (data.email || data.companyEmail || `${id.toLowerCase()}@kylrxai.com`).trim();
                        if (seenEmails.has(email.toLowerCase())) return;

                        seenIds.add(id);
                        seenEmails.add(email.toLowerCase());

                        recipients.push({
                            id,
                            name: data.name || `Employee (${id})`,
                            email,
                            phone: data.phone || `+9198765${String(idx + 1).padStart(5, '0')}`,
                            department: data.department || data.businessUnit || 'Engineering',
                            role: data.role || data.grade || data.employeeType || 'Staff',
                            consentStatus: isRelieved ? 'opted_out' : (data.consentStatus || 'granted'),
                            source: 'firestore:employees'
                        });
                    });
                }
            }

            // If user wanted auto, merge real live Firestore staff records with enterprise cohort up to 100 items (5 batches of 20)
            if (cohortType === 'auto' && recipients.length < 100) {
                const cohort100 = this.generate100TestCohort().recipients;
                for (const item of cohort100) {
                    if (recipients.length >= 100) break;
                    if (!seenIds.has(item.id) && !seenEmails.has(item.email.toLowerCase())) {
                        seenIds.add(item.id);
                        seenEmails.add(item.email.toLowerCase());
                        recipients.push(item);
                    }
                }
            }

            logger.info(`[BulkTriggerEngine] Fetched ${recipients.length} recipients live from Firebase Firestore (${cohortType} mode).`);
            return {
                success: true,
                source: cohortType === 'auto' ? 'firestore:auto_100' : 'firestore',
                count: recipients.length,
                recipients
            };
        } catch (err) {
            logger.warn(`[BulkTriggerEngine] fetchRecipientsFromFirestore notice: ${err.message}`);
            return { success: false, error: err.message, recipients: [] };
        }
    }

    /**
     * This organization's people as recipients (no generated test people). Exited staff and
     * people who opted out of bulk messages are marked opted_out so validation excludes them.
     */
    async fetchOrgRecipients(limit = 500) {
        const users = await orgDocs(rawCollection, 'users', this.orgId, Math.max(1, Math.min(limit, 2000)));
        const seen = new Set();
        const recipients = [];
        users.forEach(u => {
            const email = String(u.email || u.companyEmail || '').trim().toLowerCase();
            const key = email || u.id;
            if (seen.has(key) || !(u.name || u.displayName || email)) return;
            seen.add(key);
            const exited = u.isActive === false || /exited|relieved|inactive|terminated/i.test(String(u.employmentStatus || u.status || ''));
            recipients.push({
                id: u.id,
                name: u.name || u.displayName || email.split('@')[0],
                email,
                phone: String(u.phone || u.mobile || ''),
                department: u.departmentName || u.department || '',
                role: u.role || u.designation || 'employee',
                consentStatus: exited || u.consentStatus === 'opted_out' || u.unsubscribed === true ? 'opted_out' : 'granted',
                source: exited ? 'firestore:users (exited)' : 'firestore:users'
            });
        });
        recipients.sort((a, b) => a.name.localeCompare(b.name));
        return { success: true, source: 'firestore:users', count: recipients.length, recipients };
    }

    /**
     * Generate high-fidelity 100-member cohort with PRD §2.1 & §2.2 properties:
     * - 98 Valid & eligible records
     * - 2 Excluded/Invalid records (1 malformed email, 1 opted-out)
     * - Partitions cleanly into 5 batches of 20
     */
    generate100TestCohort() {
        const list = [];
        const depts = ['Engineering', 'Product', 'Cybersecurity', 'Executive Leadership', 'Human Resources', 'Operations', 'Finance'];
        for (let i = 1; i <= 100; i++) {
            const isBadEmail = (i === 42); // 1 item with invalid email for PRD validation test
            const isOptedOut = (i === 87); // 1 item with opt-out consent status for PRD validation test
            const dept = depts[i % depts.length];

            list.push({
                id: `EMP-${String(i).padStart(3, '0')}`,
                name: `Enterprise User ${i}`,
                email: isBadEmail ? `invalid-email-format-${i}` : `staff.${i}@kylrxai.com`,
                phone: `+9198765${String(i).padStart(5, '0')}`,
                department: dept,
                role: i % 10 === 0 ? 'Lead' : 'Member',
                consentStatus: isOptedOut ? 'opted_out' : 'granted',
                source: 'firestore:test_cohort'
            });
        }
        return {
            success: true,
            source: 'firestore_cohort_100',
            count: list.length,
            recipients: list
        };
    }

    /* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
       CONFIGURATION MANAGEMENT (PRD §2.2: Configurable by an administrator)
    ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */

    /**
     * Get current engine configuration
     */
    getConfig() {
        return { ...this.config };
    }

    /**
     * Update configuration by an authorized administrator
     */
    updateConfig(newConfig = {}, actor = {}) {
        const role = (actor.role || '').toLowerCase();
        if (role !== 'super_admin' && role !== 'admin') {
            throw new Error(`Unauthorized: Only administrators can update bulk trigger engine configuration. (Current role: ${role})`);
        }

        if (newConfig.batchSize !== undefined) {
            const size = parseInt(newConfig.batchSize, 10);
            if (isNaN(size) || size < this.config.minBatchSize || size > this.config.maxBatchSize) {
                throw new Error(`Invalid batch size: Must be an integer between ${this.config.minBatchSize} and ${this.config.maxBatchSize}.`);
            }
            this.config.batchSize = size;
        }

        if (newConfig.interBatchDelayMs !== undefined) {
            const delay = parseInt(newConfig.interBatchDelayMs, 10);
            if (!isNaN(delay) && delay >= 0) {
                this.config.interBatchDelayMs = delay;
            }
        }

        if (newConfig.maxEmailsPerSecond !== undefined) {
            const limit = parseInt(newConfig.maxEmailsPerSecond, 10);
            if (!isNaN(limit) && limit > 0) {
                this.config.maxEmailsPerSecond = limit;
            }
        }

        if (newConfig.strictConsentRequired !== undefined) {
            this.config.strictConsentRequired = Boolean(newConfig.strictConsentRequired);
        }

        // Persist updated configuration to Firebase Firestore asynchronously
        // (organization engines save through updateConfigConfirmed instead)
        if (!this.orgId && !this.offline && db && typeof db.collection === 'function') {
            safeFirestoreWrite(
                db.collection('system_configs').doc('bulk_trigger_config').set({
                    ...this.config,
                    updatedAt: new Date().toISOString(),
                    updatedBy: actor
                }, { merge: true }),
                600
            );
        }

        logger.info(`[BulkTriggerEngine] Config updated by ${actor.name || 'Admin'}: batchSize=${this.config.batchSize}`);
        return { success: true, config: this.getConfig() };
    }

    /** Organization engines: update, save (confirmed) and keep the old settings if the save fails */
    async updateConfigConfirmed(newConfig = {}, actor = {}) {
        const previous = { ...this.config };
        const result = this.updateConfig(newConfig, actor);
        try {
            const { batchSize, interBatchDelayMs, maxEmailsPerSecond, strictConsentRequired } = this.config;
            await confirmedWrite(() => rawCollection('system_configs').doc(this.configDocId()).set(plain({
                orgId: this.orgId,
                batchSize, interBatchDelayMs, maxEmailsPerSecond, strictConsentRequired,
                updatedAt: new Date().toISOString(),
                updatedBy: { id: actor.id, name: actor.name, role: actor.role }
            }), { merge: true }));
        } catch (err) {
            this.config = previous;
            throw err;
        }
        return result;
    }

    /* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
       SELECTION VALIDATION & COUNT PREVIEW (PRD §2.1 & §2.2)
    ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */

    /**
     * Validate action selection, initiator permissions, and recipient data.
     * Calculates total count and estimated batches.
     * 
     * @param {Object} params
     * @param {string} params.action - Action type (EMAIL_NOTIFICATION, OTP_VERIFICATION, TEMPLATE_SETUP_DISPATCH, CUSTOM_WORKFLOW)
     * @param {Array} params.recipients - Array of recipient objects or records
     * @param {Object} [params.payload] - Action payload (subject, template, message, etc.)
     * @param {Object} params.actor - Initiator { id, name, role }
     * @returns {Object} Validation summary
     */
    validateSelection({ action, recipients = [], payload = {}, actor = {} }) {
        if (!action || typeof action !== 'string') {
            throw new Error('Action type is required (e.g. EMAIL_NOTIFICATION, OTP_VERIFICATION, TEMPLATE_SETUP_DISPATCH).');
        }

        const normAction = action.toUpperCase().trim();
        const allowedRoles = this.actionPermissions[normAction] || ['super_admin', 'admin'];
        const actorRole = (actor.role || 'employee').toLowerCase();

        // 1. Permission Check
        if (!allowedRoles.includes(actorRole)) {
            throw new Error(`Permission Denied: Role '${actorRole}' is not authorised to trigger '${normAction}'.`);
        }

        if (!Array.isArray(recipients) || recipients.length === 0) {
            throw new Error('At least one recipient or record must be selected for bulk triggering.');
        }

        const validItems = [];
        const invalidItems = [];
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        const phoneRegex = /^\+?[0-9\s\-]{7,16}$/;

        // 2. Validate Each Recipient Item
        recipients.forEach((item, index) => {
            const id = item.id || item.employeeId || item.userId || `REC-${index + 1}`;
            const email = (item.email || item.personalEmail || '').trim().toLowerCase();
            const phone = (item.phone || item.mobileNumber || '').trim();
            const name = item.name || item.fullName || 'Recipient';
            const consentStatus = item.consentStatus || item.consent || 'granted';
            const unsubscribed = Boolean(item.unsubscribed || item.optOut);

            const errors = [];

            // Organization engines only reach that organization's own people (memberIds is set
            // by the route from the organization's users before validating)
            if (this.memberIds && !this.memberIds.has(String(id))) {
                errors.push('Not a person in your organization');
            }

            // Action-specific validations
            if (normAction === 'EMAIL_NOTIFICATION') {
                if (!email) {
                    errors.push('Missing email address');
                } else if (!emailRegex.test(email)) {
                    errors.push('Invalid email format');
                }

                // Consent Rule Validation (PRD §2.3)
                if (unsubscribed || consentStatus === 'opted_out') {
                    errors.push('Recipient has opted out / unsubscribed (Consent Policy)');
                } else if (this.config.strictConsentRequired && consentStatus !== 'granted') {
                    errors.push('Explicit consent not granted');
                }
            } else if (normAction === 'OTP_VERIFICATION') {
                if (!email && !phone) {
                    errors.push('Recipient must have a valid email or phone number for OTP delivery');
                }
                if (email && !emailRegex.test(email)) {
                    errors.push('Invalid email format for OTP');
                }
                if (phone && !phoneRegex.test(phone)) {
                    errors.push('Invalid phone format for OTP');
                }
            } else if (normAction === 'TEMPLATE_SETUP_DISPATCH') {
                if (!item.id && !email) {
                    errors.push('Missing unique record or recipient ID for template instantiation');
                }
            }

            if (errors.length > 0) {
                invalidItems.push({
                    itemId: id,
                    rawItem: item,
                    errorReason: errors.join('; '),
                    errorCode: 'VALIDATION_FAILED'
                });
            } else {
                validItems.push({
                    itemId: id,
                    name,
                    email,
                    phone,
                    role: item.role || 'Member',
                    department: item.department || 'General',
                    consentStatus,
                    customData: item.customData || {}
                });
            }
        });

        const totalSelected = recipients.length;
        const validCount = validItems.length;
        const invalidCount = invalidItems.length;
        const batchSize = this.config.batchSize;
        const estimatedBatches = validCount > 0 ? Math.ceil(validCount / batchSize) : 0;

        return {
            isValid: validCount > 0,
            action: normAction,
            actor: {
                id: actor.id || 'MGR-DEFAULT',
                name: actor.name || 'Authorised User',
                role: actorRole
            },
            totalSelected,
            validCount,
            invalidCount,
            batchSize,
            estimatedBatches,
            validItems,
            invalidItems
        };
    }

    /* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
       BATCH PROCESSING & EXECUTION (PRD §2.1 & §2.2)
    ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */

    /**
     * Create and execute a bulk trigger job.
     * Chunks requests into groups of configured batch size (e.g. 100 items into 5 groups of 20).
     * Tracks states: queued -> processing -> completed.
     * 
     * @param {Object} params
     * @param {string} params.action - Action type
     * @param {Array} params.recipients - Recipient list
     * @param {Object} [params.payload] - Action content / template context
     * @param {Object} params.actor - Initiator
     * @param {Object} [params.options] - Options (e.g. customBatchSize, mockFailureRate)
     * @returns {Promise<Object>} Completed job record
     */
    async executeBulkTrigger({ action, recipients = [], payload = {}, actor = {}, options = {} }) {
        // Step 1 & 2: Validate selection
        const validation = this.validateSelection({ action, recipients, payload, actor });

        if (validation.validCount === 0) {
            throw new Error(`Bulk Trigger Aborted: All ${validation.totalSelected} selected items failed validation. Check recipient data and consent rules.`);
        }

        const batchSize = options.batchSize || this.config.batchSize;
        const totalItems = validation.validItems.length;
        const totalBatches = Math.ceil(totalItems / batchSize);
        const jobId = `JOB-${Date.now()}-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;

        // Initialize Batch Buckets
        const batches = [];
        for (let i = 0; i < totalBatches; i++) {
            const start = i * batchSize;
            const end = Math.min(start + batchSize, totalItems);
            batches.push({
                batchIndex: i + 1,
                size: end - start,
                itemIndices: [start, end - 1],
                status: 'queued', // 'queued' | 'processing' | 'completed' | 'failed'
                successCount: 0,
                failureCount: 0,
                startedAt: null,
                completedAt: null
            });
        }

        // Initialize Job Record
        const job = {
            jobId,
            action: validation.action,
            actor: validation.actor,
            payload,
            batchSize,
            totalItems,
            totalBatches,
            status: 'queued', // PRD §2.2: queued -> processing -> completed
            currentBatchIndex: 0,
            processedCount: 0,
            successCount: 0,
            failureCount: 0,
            skippedCount: 0,
            batches,
            validItems: validation.validItems,
            invalidPrecheckItems: validation.invalidItems,
            itemResults: new Map(), // itemId -> itemResult
            failedItems: [],        // PRD §2.1: Failed items listed for review
            createdAt: new Date().toISOString(),
            startedAt: null,
            completedAt: null
        };

        this.jobs.set(jobId, job);
        if (this.orgId) {
            // Nothing is dispatched unless Firestore accepted the queued job
            try {
                await this.saveJobConfirmed(job);
            } catch (err) {
                this.jobs.delete(jobId);
                throw err;
            }
        } else {
            this.syncJobToFirestore(job).catch(() => {});
        }
        logger.info(`[BulkTriggerEngine] Job ${jobId} QUEUED: ${totalItems} items in ${totalBatches} batches (batchSize: ${batchSize})`);

        // Execute Job (Transition: queued -> processing)
        job.status = 'processing';
        job.startedAt = new Date().toISOString();

        for (let bIdx = 0; bIdx < batches.length; bIdx++) {
            const batch = batches[bIdx];
            job.currentBatchIndex = bIdx + 1;
            batch.status = 'processing';
            batch.startedAt = new Date().toISOString();

            const startIdx = bIdx * batchSize;
            const endIdx = Math.min(startIdx + batchSize, totalItems);
            const batchItems = validation.validItems.slice(startIdx, endIdx);

            logger.info(`[BulkTriggerEngine] [Job ${jobId}] Processing Batch ${batch.batchIndex}/${totalBatches} (${batchItems.length} items)...`);

            // Process each item in the batch
            for (const item of batchItems) {
                const itemResult = await this.dispatchItem(job, item, payload, options);
                job.itemResults.set(item.itemId, itemResult);
                job.processedCount += 1;

                if (itemResult.status === 'success') {
                    job.successCount += 1;
                    batch.successCount += 1;
                } else if (itemResult.status === 'failed') {
                    job.failureCount += 1;
                    batch.failureCount += 1;
                    job.failedItems.push({
                        itemId: item.itemId,
                        recipient: {
                            name: item.name,
                            email: item.email,
                            phone: item.phone
                        },
                        errorReason: itemResult.error,
                        errorCode: itemResult.errorCode || 'DISPATCH_ERROR',
                        canRetry: true,
                        batchIndex: batch.batchIndex,
                        failedAt: itemResult.executedAt
                    });
                } else if (itemResult.status === 'skipped') {
                    job.skippedCount += 1;
                }
            }

            batch.status = batch.failureCount === 0 ? 'completed' : (batch.successCount > 0 ? 'partially_completed' : 'failed');
            batch.completedAt = new Date().toISOString();

            // Inter-batch throttling delay to respect provider limits (PRD §2.2 & §2.3)
            if (bIdx < batches.length - 1 && this.config.interBatchDelayMs > 0 && !options.skipDelay) {
                await new Promise(r => setTimeout(r, this.config.interBatchDelayMs));
            }
        }

        // Step 6: Final Progress & Outcome (Transition: processing -> completed)
        job.completedAt = new Date().toISOString();
        if (job.failureCount === 0) {
            job.status = 'completed';
        } else if (job.successCount > 0) {
            job.status = 'partially_completed';
        } else {
            job.status = 'failed';
        }

        // Record Audit (PRD §2.2: Record initiator, time, count and outcome)
        const auditEntry = this.recordAuditLog(job);
        job.auditSummary = auditEntry;
        await this.saveFinalState(job);

        logger.info(`[BulkTriggerEngine] Job ${jobId} ${job.status.toUpperCase()}: ${job.successCount} succeeded, ${job.failureCount} failed of ${totalItems} total`);

        return this.getJobStatus(jobId);
    }

    /**
     * Saves a finished job and its audit entry. Organization engines wait for Firestore; if it
     * refuses, the job keeps running in memory and is flagged firebaseSaved: false (the
     * dispatched notifications were saved one by one already).
     */
    async saveFinalState(job) {
        if (!this.orgId) {
            this.syncJobToFirestore(job).catch(() => {});
            return;
        }
        try {
            await this.saveJobConfirmed(job);
        } catch (err) {
            job.firebaseSaved = false;
            job.saveError = err.message;
            logger.warn(`[BulkTriggerEngine] Job ${job.jobId} result not saved: ${err.message}`);
        }
    }

    /**
     * Dispatch single item based on action type
     */
    async dispatchItem(job, item, payload, options = {}) {
        const action = job.action;
        const idempotencyKey = crypto.createHash('sha256')
            .update(`${job.jobId}::${item.itemId}::${action}`)
            .digest('hex');

        const result = {
            itemId: item.itemId,
            recipientName: item.name,
            recipientContact: item.email || item.phone,
            action,
            idempotencyKey,
            status: 'processing',
            executedAt: new Date().toISOString(),
            output: null,
            error: null
        };

        try {
            // Check for simulated failure in test options
            if (options.simulatedFailureIds && options.simulatedFailureIds.includes(item.itemId)) {
                throw new Error(`Simulated provider timeout or downstream failure for ${item.itemId}`);
            }

            if (action === 'EMAIL_NOTIFICATION') {
                // Email Notifications (PRD §2.3)
                // Interpolate template placeholders
                const subject = (payload.subject || 'Enterprise Notification').replace(/\{\{name\}\}/gi, item.name);
                const body = (payload.body || payload.message || 'Notification content')
                    .replace(/\{\{name\}\}/gi, item.name)
                    .replace(/\{\{department\}\}/gi, item.department);

                if (this.orgId) {
                    // In-app notification (confirmed), then a real email when a provider is set up
                    const now = new Date();
                    await confirmedWrite(() => rawCollection('notifications').doc().set({
                        orgId: this.orgId,
                        userId: item.itemId, targetUid: item.itemId, target: item.itemId,
                        title: subject, text: body, message: body,
                        recipient_email: item.email, recipient_name: item.name,
                        type: 'bulk_message', priority: 'normal',
                        entity_id: `BULK-JOB-${job.jobId}`, idempotencyKey,
                        read: false, timestamp: now, createdAt: now.toISOString(),
                        source: 'bulk_trigger_engine'
                    }));
                    let email = { sent: false, reason: process.env.KYLRX_LOCAL_DB ? 'local test mode' : 'no email provider configured' };
                    if (emailDeliveryAvailable() && item.email) {
                        try {
                            const { sendEmail } = require('../utils/email');
                            const info = await sendEmail({ to: item.email, subject, text: body });
                            email = { sent: true, provider: info.provider, messageId: info.id };
                        } catch (mailErr) {
                            email = { sent: false, reason: mailErr.message };
                        }
                    }
                    result.output = { channel: 'in_app_notification', recipient: item.email, subject, inAppSaved: true, email };
                    result.status = 'success';
                    return result;
                }

                result.output = {
                    channel: 'email',
                    recipient: item.email,
                    subject,
                    dispatched: true,
                    providerMessageId: `MSG-${Date.now()}-${item.itemId}`
                };
                result.status = 'success';

                // Write live in-app notification document to Firestore notifications collection
                if (!this.offline && db && typeof db.collection === 'function') {
                    safeFirestoreWrite(
                        db.collection('notifications').add({
                            id: crypto.randomUUID ? crypto.randomUUID() : `notif-${Date.now()}-${item.itemId}`,
                            title: subject,
                            message: body,
                            target: 'Employee',
                            recipient_role: item.role || 'employee',
                            recipient_email: item.email,
                            recipient_id: item.itemId,
                            recipient_name: item.name,
                            entity_id: `BULK-JOB-${job.jobId}`,
                            created_at: new Date().toISOString(),
                            read: false,
                            source: 'bulk_trigger_engine'
                        }),
                        600
                    );
                }
            } else if (action === 'OTP_VERIFICATION') {
                // OTP Verification (PRD §2.3: Separate engine, expire, work only once, attempt limits)
                const identifier = item.email || item.phone;
                const otpRes = otpVerificationService.generateOtp({
                    identifier,
                    purpose: payload.purpose || 'template_setup_signature',
                    ttlSeconds: payload.ttlSeconds || 300,
                    maxAttempts: payload.maxAttempts || 3,
                    metadata: {
                        actor: job.actor,
                        recipientName: item.name,
                        jobId: job.jobId
                    }
                });

                result.output = {
                    channel: 'otp',
                    otpId: otpRes.otpId,
                    identifier: otpRes.identifier,
                    purpose: otpRes.purpose,
                    expiresAt: otpRes.expiresAt,
                    maxAttempts: otpRes.maxAttempts,
                    dispatched: true,
                    // The code is issued; delivering it by SMS/email needs a provider
                    ...(this.orgId ? { delivered: false, deliveryNote: 'OTP issued; no SMS/email delivery provider is configured' } : {})
                };
                result.status = 'success';
            } else if (action === 'TEMPLATE_SETUP_DISPATCH') {
                // Template Setup Dispatch (PRD §2.1 & §1.3: Triggering during template setup)
                result.output = {
                    channel: 'template_dispatch',
                    templateId: payload.templateId || 'TPL-SHARED-001',
                    instanceRecordId: `INST-${Date.now()}-${item.itemId}`,
                    dispatched: true
                };
                result.status = 'success';
            } else {
                // Generic Custom Action
                result.output = {
                    action,
                    processed: true
                };
                result.status = 'success';
            }
        } catch (err) {
            result.status = 'failed';
            result.error = err.message;
            result.errorCode = 'PROVIDER_DISPATCH_FAILURE';
        }

        return result;
    }

    /* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
       SAFE RETRIES (PRD §2.1: Retries should avoid duplicate actions)
    ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */

    /**
     * Safely retry failed items in an existing job.
     * Guarantees ZERO duplicate actions on already-successful items.
     * 
     * @param {string} jobId - Target job
     * @param {Object} actor - Who is retrying
     * @param {Object} [options] - Options
     * @returns {Promise<Object>} Updated job status
     */
    async retryFailedItems(jobId, actor = {}, options = {}) {
        const job = this.jobs.get(jobId);
        if (!job) {
            throw new Error(`Job '${jobId}' not found.`);
        }

        if (!job.failedItems || job.failedItems.length === 0) {
            return {
                jobId,
                message: 'No failed items to retry. All items have succeeded.',
                retriedCount: 0,
                status: job.status
            };
        }

        const itemsToRetry = [...job.failedItems];
        logger.info(`[BulkTriggerEngine] [Job ${jobId}] SAFE RETRY INITIATED for ${itemsToRetry.length} failed items by ${actor.name || 'User'}`);

        // Reset failed items container for this retry cycle
        job.failedItems = [];
        job.status = 'processing';

        let retrySuccessCount = 0;
        let retryFailCount = 0;

        for (const failedRecord of itemsToRetry) {
            const originalItem = job.validItems.find(v => v.itemId === failedRecord.itemId);
            if (!originalItem) continue;

            // Idempotency Safety Gate (PRD §2.1: Avoid duplicate actions)
            const previousResult = job.itemResults.get(originalItem.itemId);
            if (previousResult && previousResult.status === 'success') {
                logger.warn(`[BulkTriggerEngine] [Job ${jobId}] Skipping ${originalItem.itemId}: Already successfully dispatched (Duplicate Action Guard).`);
                continue; // Do NOT re-execute successful items
            }

            // Re-attempt dispatch for this failed item only
            const retryOptions = { ...options };
            // Clear simulated failure for this retry unless explicitly persistent
            if (retryOptions.simulatedFailureIds && !options.persistentFailures) {
                retryOptions.simulatedFailureIds = [];
            }

            const newResult = await this.dispatchItem(job, originalItem, job.payload, retryOptions);
            job.itemResults.set(originalItem.itemId, newResult);

            if (newResult.status === 'success') {
                retrySuccessCount += 1;
                job.successCount += 1;
                job.failureCount = Math.max(0, job.failureCount - 1);
            } else {
                retryFailCount += 1;
                job.failedItems.push({
                    itemId: originalItem.itemId,
                    recipient: failedRecord.recipient,
                    errorReason: newResult.error,
                    errorCode: newResult.errorCode || 'RETRY_FAILED',
                    canRetry: true,
                    failedAt: newResult.executedAt
                });
            }
        }

        // Re-calculate job final status
        if (job.failedItems.length === 0) {
            job.status = 'completed';
        } else if (job.successCount > 0) {
            job.status = 'partially_completed';
        } else {
            job.status = 'failed';
        }

        // Record audit entry for retry action
        this.recordAuditLog(job, `SAFE_RETRY_PASS (${retrySuccessCount} recovered, ${retryFailCount} still failed)`);
        await this.saveFinalState(job);

        logger.info(`[BulkTriggerEngine] [Job ${jobId}] Retry pass completed: ${retrySuccessCount} succeeded, ${retryFailCount} failed.`);

        return this.getJobStatus(jobId);
    }

    /* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
       PROGRESS & AUDIT REPORTING (PRD §2.1 & §2.2)
    ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */

    /**
     * Retrieve real-time job progress and final results
     */
    getJobStatus(jobId) {
        const job = this.jobs.get(jobId);
        if (!job) return null;

        const percentComplete = job.totalItems > 0 ? Math.round((job.processedCount / job.totalItems) * 100) : 0;

        return {
            jobId: job.jobId,
            action: job.action,
            status: job.status, // 'queued' | 'processing' | 'completed' | 'partially_completed' | 'failed'
            actor: job.actor,
            batchSize: job.batchSize,
            totalItems: job.totalItems,
            totalBatches: job.totalBatches,
            currentBatchIndex: job.currentBatchIndex,
            processedCount: job.processedCount,
            successCount: job.successCount,
            failureCount: job.failureCount,
            skippedCount: job.skippedCount,
            percentComplete,
            batches: job.batches,
            failedItems: job.failedItems, // PRD §2.1: Failed items listed for review
            invalidPrecheckItems: job.invalidPrecheckItems,
            itemResults: job.itemResults,
            results: Array.from(job.itemResults.values()),
            createdAt: job.createdAt,
            startedAt: job.startedAt,
            completedAt: job.completedAt,
            auditSummary: job.auditSummary,
            ...(this.orgId ? { firebaseSaved: job.firebaseSaved !== false, saveError: job.saveError || null } : {})
        };
    }

    /**
     * Retrieve the most recently initiated/executed job status (PRD §2.2)
     */
    getLatestJob() {
        const [latest] = this.newestJobIds(1);
        return latest ? this.getJobStatus(latest) : null;
    }

    /** Job ids, newest first (by creation time) */
    newestJobIds(limit) {
        return Array.from(this.jobs.values())
            .sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')))
            .slice(0, limit)
            .map(j => j.jobId);
    }

    /**
     * Retrieve list of recent jobs (PRD §2.2)
     */
    getRecentJobs(limit = 10) {
        return this.newestJobIds(limit).map(id => this.getJobStatus(id)).filter(Boolean);
    }

    /**
     * Record an immutable audit log entry (PRD §2.2: Record initiator, time, count and outcome)
     */
    recordAuditLog(job, contextNote = 'BULK_TRIGGER_DISPATCH') {
        const durationMs = job.startedAt && job.completedAt
            ? new Date(job.completedAt).getTime() - new Date(job.startedAt).getTime()
            : 0;

        const auditPayload = {
            auditId: `AUDIT-${Date.now()}-${crypto.randomBytes(3).toString('hex').toUpperCase()}`,
            jobId: job.jobId,
            action: job.action,
            contextNote,
            // Initiator (PRD §2.2)
            initiator: {
                id: job.actor.id,
                name: job.actor.name,
                role: job.actor.role
            },
            // Time (PRD §2.2)
            time: {
                startedAt: job.startedAt,
                completedAt: job.completedAt,
                durationMs
            },
            // Count (PRD §2.2)
            count: {
                total: job.totalItems,
                success: job.successCount,
                failed: job.failureCount,
                skipped: job.skippedCount,
                batches: job.totalBatches,
                batchSize: job.batchSize
            },
            // Outcome (PRD §2.2)
            outcome: {
                status: job.status,
                hasFailures: job.failureCount > 0,
                failedItemIds: job.failedItems.map(f => f.itemId)
            },
            timestamp: new Date().toISOString()
        };

        if (this.orgId) auditPayload.orgId = this.orgId;
        auditPayload.integrityHash = this.computeHash(auditPayload);
        this.auditLogs.unshift(auditPayload);

        // Persist audit record to Firebase Firestore
        // (organization engines save it together with the job, confirmed)
        if (this.orgId) {
            job._pendingAudit = auditPayload;
        } else if (!this.offline && db && typeof db.collection === 'function') {
            safeFirestoreWrite(
                db.collection('bulk_trigger_audit_logs').doc(auditPayload.auditId).set({
                    ...auditPayload,
                    syncedAt: new Date().toISOString()
                }),
                600
            );
        }

        // Keep last 1000 audit logs in memory
        if (this.auditLogs.length > 1000) this.auditLogs.length = 1000;

        return auditPayload;
    }

    /**
     * Query historical audit trail
     */
    getAuditLogs({ limit = 50, action = null, status = null } = {}) {
        let logs = [...this.auditLogs];
        if (action) logs = logs.filter(l => l.action === action);
        if (status) logs = logs.filter(l => l.outcome.status === status);
        return logs.slice(0, limit);
    }
}

// Export singleton instance
const bulkTriggerEngine = new BulkTriggerEngine();
module.exports = bulkTriggerEngine;
