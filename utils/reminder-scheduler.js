const { sendEmail } = require('./email');

let db;
try {
    ({ db } = require('../config/firebase'));
} catch (e) {
    console.warn('[SCHEDULER] Firebase Admin not available:', e.message);
}

/**
 * Runs the automated onboarding document reminder check.
 * Scans active onboarding candidates, tracks pending mandatory documents,
 * dispatches reminder emails twice daily, and moves non-compliant profiles to 'Hold' after 3 days (6 reminders).
 */
async function runReminderJob() {
    if (!db) {
        console.warn('[SCHEDULER] Database connection not initialized.');
        return { success: false, error: 'Database not available' };
    }

    console.log('🤖 [SCHEDULER] Running document submission reminder check...');
    const now = new Date();
    const results = { sent: 0, held: 0, skipped: 0 };

    try {
        const usersSnap = await db.collection('users')
            .where('role', '==', 'employee')
            .get();

        for (const userDoc of usersSnap.docs) {
            const userId = userDoc.id;
            const data = userDoc.data();

            // Only process candidates currently in active onboarding phases
            const isActiveOnboarding = ['Invitation Sent', 'Onboarding Started'].includes(data.onboardingStatus || data.status);
            if (!isActiveOnboarding) continue;

            // Define default mandatory documents if none are tracked
            const pendingDocs = data.pendingDocuments || ['Identity Proof', 'Address Proof', 'Academic Certificates'];
            
            // If all mandatory docs have been submitted, stop reminders
            if (pendingDocs.length === 0) {
                console.log(`[SCHEDULER] Candidate ${userId} has submitted all documents. No reminders needed.`);
                continue;
            }

            const reminderCount = data.reminderCount || 0;
            const lastSent = data.lastReminderSentAt ? new Date(data.lastReminderSentAt) : null;
            const created = data.createdAt ? new Date(data.createdAt) : now;

            // Check if 12 hours have passed since the last reminder (or since creation if first reminder)
            const msElapsed = lastSent ? (now - lastSent) : (now - created);
            const hoursElapsed = msElapsed / (1000 * 60 * 60);

            // For testing/demonstration, allow quick trigger if query parameter or forced, else require 12 hours
            const shouldSend = !lastSent || hoursElapsed >= 12;

            if (shouldSend) {
                if (reminderCount >= 6) {
                    // 3 days elapsed (6 reminders at 12-hour intervals)
                    console.log(`[SCHEDULER] Candidate ${data.fullName || data.name} failed to submit documents after 3 days. Moving to 'Hold'.`);
                    await db.collection('users').doc(userId).update({
                        onboardingStatus: 'Hold',
                        status: 'Hold',
                        holdReason: 'Failed to submit mandatory documents within 3-day window.',
                        updatedAt: new Date().toISOString()
                    });

                    // Create real-time notification for admin
                    await db.collection('notifications').add({
                        target: 'admin',
                        title: 'Candidate Onboard Hold',
                        message: `Onboarding profile for ${data.fullName || data.name} has been put on Hold due to document submission timeout.`,
                        priority: 'high',
                        read: false,
                        timestamp: new Date()
                    });

                    results.held++;
                } else {
                    // Send reminder email
                    const personalEmail = data.personalEmail || data.email;
                    if (!personalEmail) {
                        console.warn(`[SCHEDULER] Missing email address for candidate ${userId}`);
                        continue;
                    }

                    const candidateName = data.fullName || data.name || 'Candidate';
                    const listHtml = pendingDocs.map(doc => `<li>${doc}</li>`).join('');
                    
                    const html = `
                        <div style="font-family: 'Outfit', sans-serif; max-width: 600px; margin: 0 auto; padding: 25px; border: 1px solid #e5e7eb; border-radius: 20px; background-color: #ffffff;">
                            <div style="text-align: center; margin-bottom: 20px;">
                                <h2 style="color: #4f46e5; font-weight: 800; font-size: 1.5rem; margin-bottom: 5px;">Kylrx AI Enterprise</h2>
                                <p style="color: #6b7280; font-size: 0.85rem; text-transform: uppercase; letter-spacing: 1px;">Onboarding Document Vault</p>
                            </div>
                            <hr style="border: 0; border-top: 1px solid #e5e7eb; margin-bottom: 20px;" />
                            <p>Dear <strong>${candidateName}</strong>,</p>
                            <p>This is a reminder that we are awaiting the submission of your mandatory onboarding documents. You currently have <strong>${pendingDocs.length} pending document(s)</strong>:</p>
                            <ul style="background-color: #f9fafb; border-radius: 12px; padding: 15px 15px 15px 35px; color: #374151; font-weight: 600;">
                                ${listHtml}
                            </ul>
                            <p>You can temporarily skip documents that are currently unavailable, but all mandatory documents must be uploaded to finalize onboarding setup. You have <strong>${3 - Math.floor(reminderCount / 2)} day(s)</strong> remaining before your profile is flagged as hold.</p>
                            <div style="margin: 30px 0; text-align: center;">
                                <a href="http://localhost:3000/onboarding-invite.html?token=${data.onboardingToken}&id=${userId}" 
                                   style="background-color: #4f46e5; color: white; padding: 14px 28px; text-decoration: none; border-radius: 12px; font-weight: bold; display: inline-block; box-shadow: 0 4px 12px rgba(79, 70, 229, 0.2);">
                                   Upload Pending Documents
                                </a>
                            </div>
                            <p style="font-size: 0.85rem; color: #6b7280; line-height: 1.5;">Please contact human resources if you require help or extensions for your document submission.</p>
                            <hr style="border: 0; border-top: 1px solid #e5e7eb; margin: 25px 0 15px;" />
                            <p style="font-size: 0.7rem; color: #9ca3af; text-align: center;">This is an automated operational notification. Reminder ${reminderCount + 1} of 6.</p>
                        </div>
                    `;

                    await sendEmail({
                        to: personalEmail,
                        subject: `Reminder: Submit your Onboarding Documents (${reminderCount + 1}/6)`,
                        html
                    });

                    // Log reminder history audit record
                    await db.collection('onboarding_reminders_audit').add({
                        employeeId: userId,
                        employeeName: candidateName,
                        email: personalEmail,
                        triggeredBy: 'Automated System Scheduler',
                        timestamp: new Date().toISOString(),
                        message: `Automated reminder ${reminderCount + 1} sent. Pending documents: ${pendingDocs.join(', ')}`
                    });

                    // Update user's reminder state
                    await db.collection('users').doc(userId).update({
                        reminderCount: reminderCount + 1,
                        lastReminderSentAt: now.toISOString(),
                        pendingDocuments: pendingDocs,
                        updatedAt: now.toISOString()
                    });

                    results.sent++;
                }
            } else {
                results.skipped++;
            }
        }
        
        console.log(`🤖 [SCHEDULER] Completed check: ${results.sent} reminders sent, ${results.held} profiles put on Hold, ${results.skipped} skipped.`);
        return { success: true, ...results };
    } catch (error) {
        console.error('❌ [SCHEDULER] Check failed:', error);
        return { success: false, error: error.message };
    }
}

module.exports = { runReminderJob };
