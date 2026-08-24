import { db } from "./firebase-config.js";
import { 
    collection, 
    query, 
    where, 
    getDocs, 
    updateDoc, 
    doc, 
    addDoc,
    serverTimestamp 
} from "https://www.gstatic.com/firebasejs/12.12.1/firebase-firestore.js";

/**
 * HRFlow Onboarding Automation Engine
 * Handles expiry, reminders, and profile trashing.
 */
class OnboardingAutomation {
    constructor() {
        this.userColl = collection(db, "users");
    }

    async runAutomationCycle() {
        console.log("🤖 Running Global Automation Cycle...");
        const now = new Date();

        // 1. Rule: No response within 3 hours (Link Expired -> Suspended)
        await this.handleThreeHourRule(now);

        // 2. Rule: No response within 3 days (Move to Trash)
        await this.handleThreeDayRule(now);

        // 3. Rule: 3 Days Post-Onboarding Bank Verification
        await this.handleBankVerificationTask(now);

        // 4. Rule: 8-Hour Deficit Compliance (Productivity)
        try {
            const { attendanceAutomation } = await import("./attendance-automation.js");
            await attendanceAutomation.runProductivityCheck();
        } catch (e) {
            console.error("Attendance Automation Error:", e);
        }
    }

    async handleThreeHourRule(now) {
        // Simplified query to avoid composite index requirement
        const q = query(
            this.userColl, 
            where("status", "==", "Invitation Sent")
        );

        const snapshot = await getDocs(q);
        snapshot.forEach(async (d) => {
            const data = d.data();
            const expiry = data.onboardingTokenExpiry?.toDate ? data.onboardingTokenExpiry.toDate() : new Date(data.onboardingTokenExpiry);
            
            if (expiry < now && data.status !== "Suspended") {
                console.log(`⚠️ 3h Rule: Suspending ${data.fullName || data.name}`);
                await updateDoc(doc(db, "users", d.id), {
                    status: "Suspended",
                    suspensionReason: "Onboarding link expired (3h window)",
                    suspendedAt: serverTimestamp()
                });
            }
        });
    }

    async handleThreeDayRule(now) {
        const threeDaysAgo = new Date(now.getTime() - (3 * 24 * 60 * 60 * 1000));
        
        const q = query(
            this.userColl,
            where("status", "==", "Suspended")
        );

        const snapshot = await getDocs(q);
        snapshot.forEach(async (d) => {
            const data = d.data();
            const suspendedAt = data.suspendedAt?.toDate ? data.suspendedAt.toDate() : new Date(data.suspendedAt);
            
            if (suspendedAt < threeDaysAgo && data.status !== "Trash") {
                console.log(`🗑️ 3d Rule: Moving ${data.fullName || data.name} to Trash`);
                await updateDoc(doc(db, "users", d.id), {
                    status: "Trash",
                    trashedAt: serverTimestamp(),
                    retentionExpiry: new Date(now.getTime() + (30 * 24 * 60 * 60 * 1000)) // 30 day retention
                });
            }
        });
    }

    async handleBankVerificationTask(now) {
        const threeDaysAgo = new Date(now.getTime() - (3 * 24 * 60 * 60 * 1000));

        const q = query(
            this.userColl,
            where("status", "==", "Completed")
        );

        const snapshot = await getDocs(q);
        snapshot.forEach(async (d) => {
            const data = d.data();
            const completedAt = data.onboardingCompletedAt?.toDate ? data.onboardingCompletedAt.toDate() : new Date(data.onboardingCompletedAt);

            if (completedAt < threeDaysAgo && !data.bankVerificationStatus) {
                console.log(`🏦 Bank Task Rule: Notifying ${data.fullName || data.name}`);
                await updateDoc(doc(db, "users", d.id), {
                    bankVerificationStatus: "Pending",
                    lastNotificationAt: serverTimestamp()
                });

                // Create Notification
                await addDoc(collection(db, "notifications"), {
                    target: d.id,
                    message: "Action Required: Please verify your bank details for payroll processing.",
                    priority: "high",
                    link: `employee-bank-task.html?id=${d.id}`,
                    timestamp: serverTimestamp(),
                    read: false
                });
            }
        });
    }
}

export const onboardingAutomation = new OnboardingAutomation();
