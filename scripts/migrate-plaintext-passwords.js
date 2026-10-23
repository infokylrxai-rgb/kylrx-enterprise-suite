/**
 * One-time Migration Script: Bcrypt-hashes any remaining plaintext passwords
 * (including legacy tempPassword fields) and sets mustResetPassword: true.
 * 
 * Safe and idempotent: Already-hashed passwords ($2...) are untouched.
 */
require('dotenv').config();
const bcrypt = require('bcrypt');
const { admin, db } = require('../config/firebase');
const logger = require('../utils/logger');

const SALT_ROUNDS = 12;

async function migratePlaintextPasswords(options = {}) {
    const targetDb = options.db || db;
    const targetAdmin = options.admin || admin;
    const targetBcrypt = options.bcrypt || bcrypt;
    const saltRounds = options.saltRounds || SALT_ROUNDS;

    if (!targetDb || typeof targetDb.collection !== 'function') {
        throw new Error('Firestore DB instance is not available for migration.');
    }

    logger.info('[Migration] Starting plaintext password migration...');
    console.log('[Migration] Scanning users collection for plaintext passwords...');

    const snapshot = await targetDb.collection('users').get();
    let totalScanned = snapshot.size || snapshot.docs.length;
    let migratedCount = 0;
    let alreadyHashedCount = 0;
    let errors = [];

    for (const doc of snapshot.docs) {
        try {
            const data = doc.data();
            const docId = doc.id;
            const email = data.email || docId;

            const hasPlaintextPassword = data.password && typeof data.password === 'string' && !data.password.startsWith('$2');
            const hasTempPassword = data.tempPassword && typeof data.tempPassword === 'string';

            if (hasPlaintextPassword || hasTempPassword) {
                // Determine plaintext password to hash
                const rawPassword = hasTempPassword ? data.tempPassword : data.password;
                const hashedPassword = await targetBcrypt.hash(rawPassword, saltRounds);

                const updates = {
                    password: hashedPassword,
                    mustResetPassword: true,
                    migratedAt: targetAdmin && targetAdmin.firestore && targetAdmin.firestore.FieldValue
                        ? targetAdmin.firestore.FieldValue.serverTimestamp()
                        : new Date().toISOString()
                };

                // Remove legacy plaintext tempPassword field if present
                if (data.tempPassword !== undefined) {
                    if (targetAdmin && targetAdmin.firestore && targetAdmin.firestore.FieldValue) {
                        updates.tempPassword = targetAdmin.firestore.FieldValue.delete();
                    } else {
                        delete updates.tempPassword;
                    }
                }

                await (doc.ref ? doc.ref.update(updates) : targetDb.collection('users').doc(docId).update(updates));
                migratedCount++;
                logger.info(`[Migration] Migrated user ${email} (${docId}) to bcrypt hash and forced password reset.`);
            } else if (data.tempPassword !== undefined) {
                // Password was already hashed, but clean up stale tempPassword field
                const updates = {};
                if (targetAdmin && targetAdmin.firestore && targetAdmin.firestore.FieldValue) {
                    updates.tempPassword = targetAdmin.firestore.FieldValue.delete();
                }
                await (doc.ref ? doc.ref.update(updates) : targetDb.collection('users').doc(docId).update(updates));
                migratedCount++;
                logger.info(`[Migration] Removed stale tempPassword from already-hashed user ${email} (${docId}).`);
            } else {
                alreadyHashedCount++;
            }
        } catch (err) {
            logger.error(`[Migration] Error migrating doc ${doc.id}: ${err.message}`);
            errors.push({ id: doc.id, error: err.message });
        }
    }

    const summary = {
        success: errors.length === 0,
        totalScanned,
        migratedCount,
        alreadyHashedCount,
        errorCount: errors.length,
        errors
    };

    logger.info(`[Migration] Complete. Scanned: ${totalScanned}, Migrated: ${migratedCount}, Already Hashed: ${alreadyHashedCount}, Errors: ${errors.length}`);
    console.log(`[Migration] Finished. Scanned: ${totalScanned}, Migrated: ${migratedCount}, Already Hashed: ${alreadyHashedCount}, Errors: ${errors.length}`);

    return summary;
}

if (require.main === module) {
    migratePlaintextPasswords()
        .then((result) => {
            console.log('[Migration] Result Summary:', JSON.stringify(result, null, 2));
            process.exit(result.success ? 0 : 1);
        })
        .catch((err) => {
            console.error('[Migration] Fatal error during migration:', err);
            process.exit(1);
        });
}

module.exports = { migratePlaintextPasswords };
