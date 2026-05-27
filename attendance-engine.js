import { db } from "./firebase-config.js";
import { 
    collection, 
    query, 
    where, 
    getDocs, 
    addDoc,
    serverTimestamp,
    doc,
    setDoc,
    getDoc
} from "https://www.gstatic.com/firebasejs/12.12.1/firebase-firestore.js";
import { calculateAttendanceProductivity } from "./pms-service.js";

class AttendanceEngine {
    constructor() {
        this.holidayColl = collection(db, "holidays");
        this.attendanceColl = collection(db, "attendance");
        this.workHoursGoal = 8; // 8 hours requirement
    }

    async initHolidays() {
        // Sample holidays for 2026
        const holidays = [
            { name: "Independence Day", date: "2026-08-15" },
            { name: "Republic Day", date: "2026-01-26" },
            { name: "Diwali", date: "2026-11-01" },
            { name: "Christmas", date: "2026-12-25" },
            { name: "New Year", date: "2026-01-01" }
        ];

        const snap = await getDocs(this.holidayColl);
        if (snap.empty) {
            console.log("Initializing holidays collection...");
            for (const h of holidays) {
                await addDoc(this.holidayColl, h);
            }
        }
    }

    async isTodayHoliday() {
        const todayStr = new Date().toISOString().split('T')[0];
        const q = query(this.holidayColl, where("date", "==", todayStr));
        const snap = await getDocs(q);
        return !snap.empty;
    }

    async getUpcomingHolidays() {
        const todayStr = new Date().toISOString().split('T')[0];
        const snap = await getDocs(this.holidayColl);
        return snap.docs
            .map(d => d.data())
            .filter(h => h.date >= todayStr)
            .sort((a, b) => a.date.localeCompare(b.date))
            .slice(0, 3);
    }

    async syncPunch(userId, type) {
        const todayStr = new Date().toISOString().split('T')[0];
        const docId = `${userId}_${todayStr}`;
        const docRef = doc(db, "attendance", docId);
        
        const timestamp = serverTimestamp();

        // Retrieve Employee Name & Department details dynamically from Firestore
        let userName = "Employee";
        let department = "General";
        try {
            const userSnap = await getDoc(doc(db, "users", userId));
            if (userSnap.exists()) {
                const userData = userSnap.data();
                userName = userData.name || "Employee";
                if (userData.department) {
                    department = userData.department;
                } else if (userData.departmentId) {
                    const deptSnap = await getDoc(doc(db, "departments", userData.departmentId));
                    if (deptSnap.exists()) {
                        department = deptSnap.data().departmentName || deptSnap.data().name || "General";
                    }
                }
            }
        } catch (e) {
            console.error("Failed to fetch employee details for attendance:", e);
        }
        
        const punchData = {
            userId,
            userName,
            department,
            date: todayStr,
            [type === 'in' ? 'punchIn' : 'punchOut']: timestamp,
            lastUpdated: timestamp
        };

        await setDoc(docRef, punchData, { merge: true });

        // Update real-time activity status for TVC dashboard
        const activityRef = doc(db, "activityStatus", userId);
        await setDoc(activityRef, {
            status: type === 'in' ? 'Active' : 'Offline',
            lastUpdated: timestamp,
            userId: userId
        }, { merge: true });

        // If punching out, calculate productivity and apply attendance rules
        if (type === 'out') {
            const snap = await getDoc(docRef);
            if (snap.exists()) {
                const data = snap.data();
                if (data.punchIn) {
                    const punchInMs = data.punchIn.toDate ? data.punchIn.toDate().getTime() : (data.punchIn.seconds ? data.punchIn.seconds * 1000 : new Date(data.punchIn).getTime());
                    const punchOutMs = Date.now();
                    const durationMs = punchOutMs - punchInMs;
                    const durationHours = durationMs / (1000 * 60 * 60);

                    // 1. Check if yesterday was a short workday (<4h) or if there's a 3-day short streak
                    let mandated8Hours = false;
                    const q = query(this.attendanceColl, where("userId", "==", userId));
                    const pastSnaps = await getDocs(q);
                    const pastRecords = pastSnaps.docs.map(d => d.data()).sort((a, b) => b.date.localeCompare(a.date));

                    const lastCompleted = pastRecords.find(r => r.date !== todayStr && r.durationHours !== undefined);
                    if (lastCompleted && lastCompleted.durationHours < 4) {
                        mandated8Hours = true;
                    }

                    let shortDaysCount = 0;
                    for (const r of pastRecords) {
                        if (r.date === todayStr) continue;
                        if (r.durationHours !== undefined && r.durationHours < 8) {
                            shortDaysCount++;
                        } else if (r.durationHours !== undefined && r.durationHours >= 8) {
                            break;
                        }
                    }

                    if (shortDaysCount >= 3) {
                        mandated8Hours = true;
                    }

                    const requiredHours = mandated8Hours ? 8 : 4;
                    const status = durationHours >= requiredHours ? 'Present' : 'Short Hours';

                    let warningToManager = null;
                    if (durationHours < requiredHours) {
                        warningToManager = mandated8Hours 
                            ? `Warning: Employee failed their mandated 8-hour shift today (worked ${durationHours.toFixed(1)}h).`
                            : `Employee worked less than standard required 4 hours today (${durationHours.toFixed(1)}h).`;
                    }

                    // Update the attendance record with calculated fields
                    await setDoc(docRef, {
                        durationHours: durationHours,
                        status: status,
                        mandate8Hours: mandated8Hours,
                        warningSent: !!warningToManager
                    }, { merge: true });

                    // Create a notification for the manager
                    if (warningToManager) {
                        const notifRef = collection(db, "notifications");
                        await addDoc(notifRef, {
                            title: "Attendance Warning",
                            message: warningToManager,
                            type: "warning",
                            timestamp: serverTimestamp(),
                            userId: userId, // associate with this employee
                            targetRole: "manager", // routing to manager
                            read: false
                        });
                    }

                    // Original productivity calculation
                    if (data.punchOut) {
                        await calculateAttendanceProductivity(userId, data.punchIn, data.punchOut);
                    } else {
                        // Use current time approximation for productivity calculation if server timestamp is pending
                        await calculateAttendanceProductivity(userId, data.punchIn, new Date(punchOutMs));
                    }
                }
            }
        }
    }

    formatTime(ms) {
        const h = Math.floor(ms / 3600000).toString().padStart(2, '0');
        const m = Math.floor((ms % 3600000) / 60000).toString().padStart(2, '0');
        return `${h}h ${m}m`;
    }

    async getTodayPunchStatus(userId) {
        const todayStr = new Date().toISOString().split('T')[0];
        const docId = `${userId}_${todayStr}`;
        const docRef = doc(db, "attendance", docId);
        const snap = await getDoc(docRef);
        return snap.exists() ? snap.data() : null;
    }
}

export const attendanceEngine = new AttendanceEngine();
