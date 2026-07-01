import { db } from "./firebase-config.js";
import { 
    collection, 
    query, 
    where, 
    getDocs, 
    updateDoc, 
    doc, 
    addDoc,
    serverTimestamp,
    limit,
    orderBy
} from "https://www.gstatic.com/firebasejs/12.12.1/firebase-firestore.js";

/**
 * HRFlow Attendance & Productivity Automation
 * Handles 8-hour deficit rules and manager notifications.
 */
class AttendanceAutomation {
    constructor() {
        this.userColl = collection(db, "users");
        this.attColl = collection(db, "attendance");
        this.notifColl = collection(db, "notifications");
    }

    async runProductivityCheck() {
        console.log("🤖 Running Productivity & Attendance Check...");
        const snapshot = await getDocs(query(this.userColl, where("role", "==", "employee")));
        
        for (const userDoc of snapshot.docs) {
            await this.checkEmployeeCompliance(userDoc.id, userDoc.data());
        }
    }

    async checkEmployeeCompliance(userId, userData) {
        // Fetch last 7 attendance records to check for patterns
        // Simplified query to avoid composite index (Secondary sorting in JS)
        const q = query(
            this.attColl,
            where("userId", "==", userId)
        );

        const snap = await getDocs(q);
        const records = snap.docs.map(d => d.data())
            .sort((a, b) => (b.timestamp?.toDate ? b.timestamp.toDate() : new Date(b.timestamp)) - (a.timestamp?.toDate ? a.timestamp.toDate() : new Date(a.timestamp)))
            .slice(0, 7);
        
        let deficitDays = 0;
        records.forEach(rec => {
            if (rec.punchIn && rec.punchOut) {
                const pIn = rec.punchIn.toDate ? rec.punchIn.toDate() : new Date(rec.punchIn);
                const pOut = rec.punchOut.toDate ? rec.punchOut.toDate() : new Date(rec.punchOut);
                const hours = (pOut - pIn) / 3600000;
                
                if (hours < 8) {
                    deficitDays++;
                }
            }
        });

        // Rule: 3 days of deficit (< 8h) triggers manager alert
        if (deficitDays >= 3 && userData.lastDeficitAlertCount !== deficitDays) {
            console.log(`⚠️ Productivity Alert: ${userData.name} has ${deficitDays} deficit days.`);
            await this.notifyManager(userId, userData, deficitDays);
            
            // Update user to prevent duplicate alerts for the same count
            await updateDoc(doc(db, "users", userId), {
                lastDeficitAlertCount: deficitDays,
                productivityStatus: "Warning"
            });
        }
    }

    async notifyManager(userId, userData, deficitDays) {
        const deptId = userData.departmentId;
        if (!deptId) return;

        // Find manager for this department
        // Simplified query to avoid composite index (Secondary filter in JS)
        const mq = query(
            this.userColl,
            where("role", "==", "manager")
        );

        const mSnap = await getDocs(mq);
        const managers = mSnap.docs.filter(mDoc => mDoc.data().departmentId === deptId);
        
        managers.forEach(async (mDoc) => {
            await addDoc(this.notifColl, {
                target: mDoc.id,
                type: "Productivity Alert",
                priority: "high",
                message: `Attendance Alert: ${userData.name} has worked less than 8 hours for ${deficitDays} days in the recent period. Please review operational compliance.`,
                employeeId: userId,
                departmentId: deptId,
                timestamp: serverTimestamp(),
                read: false
            });
        });
    }
}

export const attendanceAutomation = new AttendanceAutomation();
