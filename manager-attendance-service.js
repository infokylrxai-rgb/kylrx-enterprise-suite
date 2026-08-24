import { db, auth } from "./firebase-config.js";
import { 
    doc, 
    setDoc, 
    getDoc,
    getDocs,
    query,
    where,
    collection, 
    serverTimestamp,
    onSnapshot
} from "https://www.gstatic.com/firebasejs/12.12.1/firebase-firestore.js";

class ManagerAttendanceService {
    constructor() {
        this.managerTimerInterval = null;
        this.managerStartTime = 0;
        this.managerTotalPausedTime = 0;
        this.managerBreakStartTime = 0;
        this.mandated8HoursToday = false;
        this.currentUserId = null;
    }

    injectStatusModal() {
        if (document.getElementById('statusModalOverlay')) return;
        const modalHtml = `
        <div id="statusModalOverlay" class="custom-alert-overlay">
            <div class="custom-alert-card" style="max-width: 400px; text-align: center;">
                <div id="statusModalIcon" style="width: 64px; height: 64px; border-radius: 20px; display: flex; align-items: center; justify-content: center; margin: 0 auto 1.5rem; font-size: 1.5rem;">
                    <i data-lucide="info"></i>
                </div>
                <h2 id="statusModalTitle" style="font-size: 1.25rem; font-weight: 800; margin-bottom: 0.5rem;">Status</h2>
                <p id="statusModalDesc" style="color: var(--text-muted); font-size: 0.9rem; margin-bottom: 2rem; line-height: 1.6; text-align: center;">Message content goes here.</p>
                <button class="alert-btn" style="margin-top: 0; display: block; width: 100%;" id="closeStatusModalBtn">Dismiss</button>
            </div>
        </div>`;
        document.body.insertAdjacentHTML('beforeend', modalHtml);
        document.getElementById('closeStatusModalBtn').onclick = () => this.closeStatusModal();
    }

    injectMandateAlert() {
        if (document.getElementById('mandateAlert')) return;
        const header = document.querySelector('header.header');
        if (!header) return;
        const bannerHtml = `
        <div id="mandateAlert" style="display: none; background: #fffbeb; border: 1.5px solid #fde68a; border-radius: 12px; padding: 10px 14px; margin-bottom: 20px; align-items: center; gap: 10px; font-size: 0.8rem; font-weight: 700; color: #b45309;">
            <i data-lucide="alert-triangle" style="color: #d97706; width: 18px; height: 18px;"></i>
            <span>Strict 8-Hour Mandate Active today due to short-hours (&lt;4h) yesterday!</span>
        </div>`;
        header.insertAdjacentHTML('afterend', bannerHtml);
    }

    showStatusModal(title, msg, type = 'info') {
        this.injectStatusModal();
        const overlay = document.getElementById('statusModalOverlay');
        const icon = document.getElementById('statusModalIcon');
        const titleEl = document.getElementById('statusModalTitle');
        const descEl = document.getElementById('statusModalDesc');

        if (titleEl) titleEl.textContent = title;
        if (descEl) descEl.textContent = msg;
        
        if (icon) {
            if (type === 'success') {
                icon.style.background = '#dcfce7';
                icon.style.color = '#10b981';
                icon.innerHTML = '<i data-lucide="check-circle"></i>';
            } else if (type === 'error') {
                icon.style.background = '#fee2e2';
                icon.style.color = '#ef4444';
                icon.innerHTML = '<i data-lucide="x-circle"></i>';
            } else {
                icon.style.background = '#dbeafe';
                icon.style.color = '#3b82f6';
                icon.innerHTML = '<i data-lucide="info"></i>';
            }
        }
        
        if (overlay) overlay.style.display = 'flex';
        if (window.lucide) window.lucide.createIcons();
    }

    closeStatusModal() {
        const overlay = document.getElementById('statusModalOverlay');
        if (overlay) overlay.style.display = 'none';
    }

    async checkPreviousDayMandate(uid) {
        try {
            const q = query(
                collection(db, 'attendance'),
                where('userId', '==', uid)
            );
            const pastSnaps = await getDocs(q);
            const logs = pastSnaps.docs.map(doc => doc.data()).sort((a, b) => b.date.localeCompare(a.date));
            const todayStr = new Date().toISOString().split('T')[0];
            const lastCompletedDay = logs.find(l => l.date !== todayStr && l.durationHours !== undefined);
            if (lastCompletedDay && lastCompletedDay.durationHours < 4) {
                this.mandated8HoursToday = true;
                this.injectMandateAlert();
                const mandateAlert = document.getElementById('mandateAlert');
                if (mandateAlert) mandateAlert.style.display = 'flex';
                if (window.lucide) window.lucide.createIcons();
            }
        } catch (e) {
            console.error("Error checking previous day's duration:", e);
        }
    }

    async syncStatus(status, type) {
        const userId = this.currentUserId || localStorage.getItem('hr_user_id') || 'manager_demo';
        const today = new Date().toISOString().split('T')[0];
        
        // Internal Manager Session
        const statusRef = doc(db, "manager_sessions", `${userId}_${today}`);
        const sessionData = {
            status: status,
            lastUpdated: serverTimestamp(),
            userId: userId,
            role: 'manager',
            name: localStorage.getItem('userName') || 'Manager',
            department: localStorage.getItem('userDept') || 'General',
            date: today
        };
        if (type === 'in') sessionData.punchIn = serverTimestamp();
        if (type === 'out') sessionData.punchOut = serverTimestamp();
        await setDoc(statusRef, sessionData, { merge: true });

        // Global Attendance Sync for Admin Visibility
        const attRef = doc(db, "attendance", `${userId}_${today}`);
        const updateData = {
            status: status === 'Active' ? 'Online' : (status === 'Break' ? 'On Break' : 'Shift Completed'),
            lastUpdated: serverTimestamp(),
            userId: userId,
            name: localStorage.getItem('userName') || 'Manager',
            userName: localStorage.getItem('userName') || 'Manager',
            role: 'manager',
            department: localStorage.getItem('userDept') || 'General',
            date: today
        };

        if (type === 'in') {
            updateData.punchIn = serverTimestamp();
            updateData.status = 'Present';
        }
        if (type === 'out') {
            updateData.punchOut = serverTimestamp();
            try {
                const snap = await getDoc(attRef);
                if (snap.exists()) {
                    const data = snap.data();
                    if (data.punchIn) {
                        const punchInMs = data.punchIn.toDate ? data.punchIn.toDate().getTime() : (data.punchIn.seconds ? data.punchIn.seconds * 1000 : new Date(data.punchIn).getTime());
                        const punchOutMs = Date.now();
                        const durationMs = punchOutMs - this.managerTotalPausedTime - punchInMs;
                        const durationHours = Math.max(0, durationMs / (1000 * 60 * 60));
                        updateData.durationHours = durationHours;
                        updateData.status = durationHours >= 4 ? 'Present' : 'Short Hours';
                    } else {
                        updateData.status = 'Present';
                    }
                } else {
                    updateData.status = 'Present';
                }
            } catch (e) {
                console.error("Error setting punch out details:", e)
                updateData.status = 'Present';
            }
        }

        await setDoc(attRef, updateData, { merge: true });
    }

    startManagerTimer() {
        const timerDisplay = document.getElementById('adminSessionTimer');
        if (!timerDisplay) return;
        clearInterval(this.managerTimerInterval);
        this.managerTimerInterval = setInterval(() => {
            const diff = Date.now() - this.managerStartTime;
            const h = Math.floor(diff / 3600000).toString().padStart(2, '0');
            const m = Math.floor((diff % 3600000) / 60000).toString().padStart(2, '0');
            const s = Math.floor((diff % 60000) / 1000).toString().padStart(2, '0');
            timerDisplay.textContent = `${h}:${m}:${s}`;
        }, 1000);
    }

    async managerPunchIn() {
        const btnIn = document.getElementById('btnPunchIn');
        const btnBreak = document.getElementById('btnBreak');
        const btnOut = document.getElementById('btnPunchOut');
        const tvcDot = document.getElementById('tvcDot');
        const tvcText = document.getElementById('tvcStatusText');
        const timerDisplay = document.getElementById('adminSessionTimer');

        if (tvcText) tvcText.textContent = "SECURE: CONNECTING...";
        if (tvcDot) tvcDot.style.background = "#3b82f6";
        
        setTimeout(async () => {
            if (tvcText) tvcText.textContent = "SECURE: ACTIVE";
            if (tvcDot) {
                tvcDot.style.background = "var(--success)";
                tvcDot.style.boxShadow = "0 0 10px var(--success)";
            }
            
            this.managerStartTime = Date.now();
            this.managerTotalPausedTime = 0;
            if (timerDisplay) timerDisplay.style.display = 'inline';
            this.startManagerTimer();

            await this.syncStatus('Active', 'in');
            
            if (btnIn) btnIn.style.display = 'none';
            if (btnBreak) {
                btnBreak.disabled = false;
                btnBreak.style.opacity = '1';
            }
            if (btnOut) btnOut.style.display = 'flex';
        }, 1000);
    }

    async managerBreak() {
        const btnBreak = document.getElementById('btnBreak');
        const tvcDot = document.getElementById('tvcDot');
        const tvcText = document.getElementById('tvcStatusText');

        if (!btnBreak) return;
        if (btnBreak.textContent.includes('Break')) {
            clearInterval(this.managerTimerInterval);
            this.managerBreakStartTime = Date.now();
            btnBreak.innerHTML = '<i data-lucide="play" size="14"></i> Resume';
            btnBreak.style.background = "#3b82f6";
            if (tvcText) tvcText.textContent = "SECURE: PAUSED";
            if (tvcDot) {
                tvcDot.style.background = "#f59e0b";
                tvcDot.style.boxShadow = "none";
            }
            await this.syncStatus('Break', 'break');
        } else {
            const pausedDiff = Date.now() - this.managerBreakStartTime;
            this.managerTotalPausedTime += pausedDiff;
            this.managerStartTime += pausedDiff;
            this.startManagerTimer();
            btnBreak.innerHTML = '<i data-lucide="coffee" size="14"></i> Break';
            btnBreak.style.background = "#f59e0b";
            if (tvcText) tvcText.textContent = "SECURE: ACTIVE";
            if (tvcDot) {
                tvcDot.style.background = "var(--success)";
                tvcDot.style.boxShadow = "0 0 10px var(--success)";
            }
            await this.syncStatus('Active', 'resume');
        }
        if (window.lucide) window.lucide.createIcons();
    }

    async managerPunchOut() {
        const btnIn = document.getElementById('btnPunchIn');
        const btnBreak = document.getElementById('btnBreak');
        const btnOut = document.getElementById('btnPunchOut');
        const tvcDot = document.getElementById('tvcDot');
        const tvcText = document.getElementById('tvcStatusText');
        const timerDisplay = document.getElementById('adminSessionTimer');

        const totalTime = Date.now() - this.managerStartTime;

        clearInterval(this.managerTimerInterval);
        if (tvcText) tvcText.textContent = "SECURE: IDLE";
        if (tvcDot) {
            tvcDot.style.background = "#cbd5e1";
            tvcDot.style.boxShadow = "none";
        }
        if (timerDisplay) timerDisplay.style.display = 'none';

        await this.syncStatus('Offline', 'out');

        if (btnIn) btnIn.style.display = 'flex';
        if (btnBreak) {
            btnBreak.disabled = true;
            btnBreak.style.opacity = '0.5';
            btnBreak.innerHTML = '<i data-lucide="coffee" size="14"></i> Break';
            btnBreak.style.background = "#f59e0b";
        }
        if (btnOut) btnOut.style.display = 'none';
        if (window.lucide) window.lucide.createIcons();

        // 8 Hour Quota Check
        const eightHoursMs = 8 * 3600000;
        if (this.mandated8HoursToday && totalTime < eightHoursMs) {
            const diff = eightHoursMs - totalTime;
            const h = Math.floor(diff / 3600000);
            const m = Math.floor((diff % 3600000) / 60000);
            this.showStatusModal('Mandated Shift Violation', `CRITICAL WARNING: You have failed your mandated 8-hour shift requirement today (due to a short-hours <4h workday yesterday). Remaining: ${h}h ${m}m. Your system dashboard has recorded this violation.`, 'error');
        } else if (totalTime < eightHoursMs) {
            const diff = eightHoursMs - totalTime;
            const h = Math.floor(diff / 3600000);
            const m = Math.floor((diff % 3600000) / 60000);
            this.showStatusModal('Shift Compliance Warning', `Attention: You are punching out before completing your 8-hour shift. Remaining: ${h}h ${m}m.`, 'error');
        }
    }

    restoreManagerSession(userId) {
        this.currentUserId = userId;
        this.checkPreviousDayMandate(userId);
        this.injectStatusModal();

        // Bind utility globally for windows
        window.managerPunchIn = () => this.managerPunchIn();
        window.managerBreak = () => this.managerBreak();
        window.managerPunchOut = () => this.managerPunchOut();
        window.showStatusModal = (title, msg, type) => this.showStatusModal(title, msg, type);
        window.closeStatusModal = () => this.closeStatusModal();
        
        const today = new Date().toISOString().split('T')[0];
        const statusRef = doc(db, "manager_sessions", `${userId}_${today}`);
        const btnIn = document.getElementById('btnPunchIn');
        const btnBreak = document.getElementById('btnBreak');
        const btnOut = document.getElementById('btnPunchOut');
        const tvcDot = document.getElementById('tvcDot');
        const tvcText = document.getElementById('tvcStatusText');
        const timerDisplay = document.getElementById('adminSessionTimer');

        onSnapshot(statusRef, (docSnap) => {
            if (docSnap.exists()) {
                const data = docSnap.data();
                if (data.status === 'Active' || data.status === 'Break') {
                    if (btnIn) btnIn.style.display = 'none';
                    if (btnOut) btnOut.style.display = 'flex';
                    if (btnBreak) {
                        btnBreak.disabled = false;
                        btnBreak.style.opacity = '1';
                    }
                    
                    if (data.punchIn) {
                        const pIn = data.punchIn.toDate ? data.punchIn.toDate() : new Date(data.punchIn);
                        this.managerStartTime = pIn.getTime();
                        if (timerDisplay) timerDisplay.style.display = 'inline';
                        
                        if (data.status === 'Active') {
                           if (tvcText) tvcText.textContent = "SECURE: ACTIVE";
                           if (tvcDot) {
                               tvcDot.style.background = "var(--success)";
                               tvcDot.style.boxShadow = "0 0 10px var(--success)";
                           }
                           if (btnBreak) {
                               btnBreak.innerHTML = '<i data-lucide="coffee" size="14"></i> Break';
                               btnBreak.style.background = "#f59e0b";
                           }
                           this.startManagerTimer();
                        } else {
                           if (tvcText) tvcText.textContent = "SECURE: PAUSED";
                           if (tvcDot) {
                               tvcDot.style.background = "#f59e0b";
                               tvcDot.style.boxShadow = "none";
                           }
                           if (btnBreak) {
                               btnBreak.innerHTML = '<i data-lucide="play" size="14"></i> Resume';
                               btnBreak.style.background = "#3b82f6";
                           }
                           clearInterval(this.managerTimerInterval);
                           
                           // Static timer update for paused state
                           const diff = Date.now() - this.managerStartTime;
                           const h = Math.floor(diff / 3600000).toString().padStart(2, '0');
                           const m = Math.floor((diff % 3600000) / 60000).toString().padStart(2, '0');
                           const s = Math.floor((diff % 60000) / 1000).toString().padStart(2, '0');
                           if (timerDisplay) timerDisplay.textContent = `${h}:${m}:${s}`;
                        }
                    }
                } else if (data.status === 'Offline') {
                   if (btnIn) btnIn.style.display = 'flex';
                   if (btnBreak) {
                       btnBreak.disabled = true;
                       btnBreak.style.opacity = '0.5';
                       btnBreak.innerHTML = '<i data-lucide="coffee" size="14"></i> Break';
                       btnBreak.style.background = "#f59e0b";
                   }
                   if (btnOut) btnOut.style.display = 'none';
                   if (tvcText) tvcText.textContent = "SECURE: IDLE";
                   if (tvcDot) {
                       tvcDot.style.background = "#cbd5e1";
                       tvcDot.style.boxShadow = "none";
                   }
                   if (timerDisplay) timerDisplay.style.display = 'none';
                }
            }
            if (window.lucide) window.lucide.createIcons();
        });
    }
}

export const managerAttendanceService = new ManagerAttendanceService();
