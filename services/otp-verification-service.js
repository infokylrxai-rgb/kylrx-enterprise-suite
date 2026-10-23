const crypto = require('crypto');
const logger = require('../utils/logger');
const { db } = require('../config/firebase');

function safeFirestoreWrite(writePromise, timeoutMs = 600) {
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
 * OTP Verification Service (PRD §2.3)
 * 
 * Separate engine for one-time passcode management:
 * - Cryptographically secure generation (6-digit numeric)
 * - Strict expiration timestamp (configurable TTL, default 300s / 5 mins)
 * - Single-use enforcement (invalidated immediately upon successful verification)
 * - Maximum attempt limits (locks / invalidates OTP upon reaching limit, default 3 attempts)
 * - Resend throttling & rate-limiting per recipient
 * - Complete audit trail of issuance and verification events
 */
class OtpVerificationService {
    constructor() {
        // In-memory store for OTP records: otpId -> record
        this.otps = new Map();
        // Lookup by identifier + purpose -> latest active otpId
        this.activeLookups = new Map();
        // Audit log of OTP verification attempts
        this.auditLogs = [];
        // Default configs
        this.defaultTtlSeconds = 300; // 5 minutes
        this.defaultMaxAttempts = 3;
        this.resendCooldownSeconds = 30; // 30s before allowing new OTP for same recipient+purpose
    }

    /**
     * Generate secure hash of the OTP code
     */
    hashOtp(code, salt = 'kylrx-otp-salt') {
        return crypto.createHmac('sha256', salt).update(String(code).trim()).digest('hex');
    }

    /**
     * Generate a new cryptographically secure 6-digit OTP (PRD §2.3)
     * 
     * @param {Object} params
     * @param {string} params.identifier - Email, phone number, or employee ID
     * @param {string} params.purpose - Purpose (e.g. 'authentication', 'template_setup_signature', 'bulk_onboarding_verification')
     * @param {number} [params.ttlSeconds=300] - Expiration duration in seconds
     * @param {number} [params.maxAttempts=3] - Maximum failed verification attempts
     * @param {Object} [params.metadata={}] - Additional context (recipientName, actor, channel)
     * @returns {Object} { otpId, identifier, purpose, expiresAt, maxAttempts, attemptsRemaining, code }
     */
    generateOtp({ identifier, purpose = 'general_verification', ttlSeconds = 300, maxAttempts = 3, metadata = {} }) {
        if (!identifier || typeof identifier !== 'string' || !identifier.trim()) {
            throw new Error('Valid recipient identifier (email/phone) is required for OTP generation.');
        }

        const cleanIdentifier = identifier.trim().toLowerCase();
        const cleanPurpose = purpose.trim().toLowerCase();
        const lookupKey = `${cleanIdentifier}::${cleanPurpose}`;

        // 1. Resend Throttling Check
        const existingOtpId = this.activeLookups.get(lookupKey);
        if (existingOtpId) {
            const existing = this.otps.get(existingOtpId);
            if (existing && existing.status === 'active') {
                const elapsedSeconds = (Date.now() - existing.createdAt) / 1000;
                if (elapsedSeconds < this.resendCooldownSeconds) {
                    const waitTime = Math.ceil(this.resendCooldownSeconds - elapsedSeconds);
                    throw new Error(`OTP already issued. Please wait ${waitTime}s before requesting a new code.`);
                }
                // Invalidate previous active OTP if still unconsumed
                existing.status = 'superseded';
            }
        }

        // 2. Cryptographically secure 6-digit number [100000, 999999]
        const rawCode = String(crypto.randomInt(100000, 1000000));
        const otpId = `OTP-${Date.now()}-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;
        const expiresAt = Date.now() + (ttlSeconds * 1000);

        const record = {
            id: otpId,
            identifier: cleanIdentifier,
            purpose: cleanPurpose,
            codeHash: this.hashOtp(rawCode),
            rawCode: process.env.NODE_ENV !== 'production' ? rawCode : undefined, // accessible in tests & local dev
            status: 'active', // 'active' | 'used' | 'expired' | 'locked' | 'superseded'
            attemptsCount: 0,
            maxAttempts: maxAttempts || this.defaultMaxAttempts,
            attemptsRemaining: maxAttempts || this.defaultMaxAttempts,
            ttlSeconds,
            createdAt: Date.now(),
            expiresAt,
            usedAt: null,
            metadata: {
                ...metadata,
                deliveryChannel: metadata.deliveryChannel || (cleanIdentifier.includes('@') ? 'email' : 'sms')
            }
        };

        this.otps.set(otpId, record);
        this.activeLookups.set(lookupKey, otpId);

        // Persist to Firebase Firestore
        if (db && typeof db.collection === 'function') {
            safeFirestoreWrite(
                db.collection('otp_verifications').doc(otpId).set({
                    id: otpId,
                    identifier: cleanIdentifier,
                    purpose: cleanPurpose,
                    codeHash: record.codeHash,
                    status: record.status,
                    attemptsCount: record.attemptsCount,
                    maxAttempts: record.maxAttempts,
                    attemptsRemaining: record.attemptsRemaining,
                    ttlSeconds,
                    createdAt: record.createdAt,
                    expiresAt,
                    metadata: record.metadata
                }, { merge: true }),
                600
            );
        }

        logger.info(`[OtpService] Generated OTP ${otpId} for ${cleanIdentifier} (purpose: ${cleanPurpose}, expires in ${ttlSeconds}s)`);

        return {
            otpId,
            identifier: cleanIdentifier,
            purpose: cleanPurpose,
            expiresAt: new Date(expiresAt).toISOString(),
            expiresAtMs: expiresAt,
            ttlSeconds,
            maxAttempts: record.maxAttempts,
            attemptsRemaining: record.attemptsRemaining,
            code: rawCode // Dispatched to user via SMS/Email
        };
    }

    /**
     * Verify an OTP (PRD §2.3)
     * - Must not be expired
     * - Single-use only (status -> 'used')
     * - Decrements attempt limit on failure; locks OTP when exceeded
     * 
     * @param {Object} params
     * @param {string} [params.otpId] - Specific OTP ID
     * @param {string} [params.identifier] - Recipient identifier
     * @param {string} [params.purpose='general_verification'] - Verification purpose
     * @param {string} params.code - 6-digit candidate code
     * @param {Object} [params.actor] - Who attempted verification
     * @returns {Object} Verification result
     */
    verifyOtp({ otpId, identifier, purpose = 'general_verification', code, actor = {} }) {
        if (!code || typeof code !== 'string' || !code.trim()) {
            return {
                success: false,
                reason: 'MISSING_CODE',
                message: 'A 6-digit verification code must be provided.'
            };
        }

        let record = null;
        if (otpId) {
            record = this.otps.get(otpId);
        } else if (identifier) {
            const cleanIdentifier = identifier.trim().toLowerCase();
            const cleanPurpose = (purpose || 'general_verification').trim().toLowerCase();
            const lookupKey = `${cleanIdentifier}::${cleanPurpose}`;
            const foundId = this.activeLookups.get(lookupKey);
            if (foundId) record = this.otps.get(foundId);
        }

        if (!record) {
            this.recordAudit({ otpId: otpId || 'UNKNOWN', identifier, purpose, outcome: 'NOT_FOUND', actor });
            return {
                success: false,
                reason: 'OTP_NOT_FOUND',
                message: 'No active OTP found matching this request. Please generate a new code.'
            };
        }

        // 1. Single-use Check (PRD §2.3: "work only once")
        if (record.status === 'used') {
            this.recordAudit({ otpId: record.id, identifier: record.identifier, purpose: record.purpose, outcome: 'ALREADY_USED', actor });
            return {
                success: false,
                reason: 'OTP_ALREADY_USED',
                message: 'This OTP has already been verified and cannot be reused (Single-Use Policy).',
                verifiedAt: record.usedAt
            };
        }

        // 2. Attempt Limits Check (PRD §2.3: "have attempt limits")
        if (record.status === 'locked' || record.attemptsRemaining <= 0) {
            this.recordAudit({ otpId: record.id, identifier: record.identifier, purpose: record.purpose, outcome: 'MAX_ATTEMPTS_EXCEEDED', actor });
            return {
                success: false,
                reason: 'OTP_MAX_ATTEMPTS_EXCEEDED',
                message: `Maximum verification attempts (${record.maxAttempts}) exceeded. This OTP has been permanently invalidated.`,
                attemptsCount: record.attemptsCount
            };
        }

        // 3. Expiration Check (PRD §2.3: "OTPs should expire")
        if (Date.now() > record.expiresAt || record.status === 'expired') {
            record.status = 'expired';
            this.recordAudit({ otpId: record.id, identifier: record.identifier, purpose: record.purpose, outcome: 'EXPIRED', actor });
            return {
                success: false,
                reason: 'OTP_EXPIRED',
                message: 'This OTP has expired. Please request a fresh verification code.',
                expiredAt: new Date(record.expiresAt).toISOString()
            };
        }

        // 4. Validate Code
        const candidateHash = this.hashOtp(code);
        const isMatch = crypto.timingSafeEqual(Buffer.from(candidateHash, 'hex'), Buffer.from(record.codeHash, 'hex'));

        if (!isMatch) {
            record.attemptsCount += 1;
            record.attemptsRemaining = Math.max(0, record.maxAttempts - record.attemptsCount);

            if (record.attemptsRemaining <= 0) {
                record.status = 'locked';
            }

            this.recordAudit({
                otpId: record.id,
                identifier: record.identifier,
                purpose: record.purpose,
                outcome: record.status === 'locked' ? 'MAX_ATTEMPTS_EXCEEDED' : 'INVALID_CODE',
                attemptsRemaining: record.attemptsRemaining,
                actor
            });

            // Update Firebase Firestore on failure/lock
            if (db && typeof db.collection === 'function') {
                safeFirestoreWrite(
                    db.collection('otp_verifications').doc(record.id).set({
                        status: record.status,
                        attemptsCount: record.attemptsCount,
                        attemptsRemaining: record.attemptsRemaining,
                        updatedAt: new Date().toISOString()
                    }, { merge: true }),
                    600
                );
            }

            return {
                success: false,
                reason: record.status === 'locked' ? 'OTP_MAX_ATTEMPTS_EXCEEDED' : 'INVALID_CODE',
                message: record.status === 'locked'
                    ? `Invalid code. Maximum attempts reached (${record.maxAttempts}). OTP is now locked.`
                    : `Incorrect verification code. ${record.attemptsRemaining} attempt(s) remaining.`,
                attemptsRemaining: record.attemptsRemaining,
                attemptsCount: record.attemptsCount,
                maxAttempts: record.maxAttempts
            };
        }

        // 5. Success -> Mark as USED (Single-Use Enforced)
        record.status = 'used';
        record.usedAt = new Date().toISOString();
        record.attemptsCount += 1;

        // Update Firebase Firestore on success
        if (db && typeof db.collection === 'function') {
            safeFirestoreWrite(
                db.collection('otp_verifications').doc(record.id).set({
                    status: record.status,
                    usedAt: record.usedAt,
                    attemptsCount: record.attemptsCount,
                    attemptsRemaining: record.attemptsRemaining,
                    updatedAt: new Date().toISOString()
                }, { merge: true }),
                600
            );
        }

        this.recordAudit({
            otpId: record.id,
            identifier: record.identifier,
            purpose: record.purpose,
            outcome: 'SUCCESS',
            actor
        });

        logger.info(`[OtpService] ✅ OTP ${record.id} successfully verified for ${record.identifier}`);

        return {
            success: true,
            otpId: record.id,
            identifier: record.identifier,
            purpose: record.purpose,
            verifiedAt: record.usedAt,
            message: 'OTP verified successfully.'
        };
    }

    /**
     * Get sanitized OTP status
     */
    getOtpStatus(otpId) {
        const record = this.otps.get(otpId);
        if (!record) return null;

        const isExpired = Date.now() > record.expiresAt;
        const currentStatus = (record.status === 'active' && isExpired) ? 'expired' : record.status;

        return {
            otpId: record.id,
            identifier: record.identifier,
            purpose: record.purpose,
            status: currentStatus,
            attemptsCount: record.attemptsCount,
            maxAttempts: record.maxAttempts,
            attemptsRemaining: record.attemptsRemaining,
            createdAt: new Date(record.createdAt).toISOString(),
            expiresAt: new Date(record.expiresAt).toISOString(),
            isExpired,
            usedAt: record.usedAt
        };
    }

    /**
     * Internal audit entry recorder
     */
    recordAudit({ otpId, identifier, purpose, outcome, attemptsRemaining, actor = {} }) {
        const auditEntry = {
            logId: `LOG-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
            otpId,
            identifier,
            purpose,
            outcome,
            attemptsRemaining: attemptsRemaining !== undefined ? attemptsRemaining : null,
            actor: {
                id: actor.id || 'anonymous',
                name: actor.name || 'Anonymous User',
                role: actor.role || 'user'
            },
            timestamp: new Date().toISOString()
        };

        this.auditLogs.unshift(auditEntry);
        if (this.auditLogs.length > 500) this.auditLogs.length = 500;

        // Persist audit record to Firebase Firestore
        if (db && typeof db.collection === 'function') {
            safeFirestoreWrite(
                db.collection('otp_audit_logs').doc(auditEntry.logId).set(auditEntry),
                600
            );
        }
    }

    /**
     * Get OTP audit logs
     */
    getAuditLogs(limit = 50) {
        return this.auditLogs.slice(0, limit);
    }
}

// Export singleton instance
const otpVerificationService = new OtpVerificationService();
module.exports = otpVerificationService;
