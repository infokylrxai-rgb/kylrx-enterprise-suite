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
        const punchData = {
            userId,
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

        // If punching out, calculate productivity
        if (type === 'out') {
            const snap = await getDoc(docRef);
            if (snap.exists()) {
                const data = snap.data();
                if (data.punchIn && data.punchOut) {
                    await calculateAttendanceProductivity(userId, data.punchIn, data.punchOut);
                }
            }
        }
    }

    formatTime(ms) {
        const h = Math.floor(ms / 3600000).toString().padStart(2, '0');
        const m = Math.floor((ms % 3600000) / 60000).toString().padStart(2, '0');
        return `${h}h ${m}m`;
    }
}

export const attendanceEngine = new AttendanceEngine();
