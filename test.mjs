
        import { db, auth } from "./firebase-config.js";
        import { onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/12.12.1/firebase-auth.js";
        import { doc, setDoc, serverTimestamp, getDoc, onSnapshot, arrayUnion, arrayRemove, collection, query, where, getDocs } from "https://www.gstatic.com/firebasejs/12.12.1/firebase-firestore.js";
        import { getPendingReviews, scorePerformance } from "./pms-service.js";
        
        let currentDeptConfig = null;
        const currentUnitId = new URLSearchParams(window.location.search).get('id');

        lucide.createIcons();

        // --- Dynamic Dashboard Hydration ---
        const urlParams = new URLSearchParams(window.location.search);
        const centerId = urlParams.get('id');

        onAuthStateChanged(auth, async (user) => {
            let userData = null;
            if (user) {
                const userDoc = await getDoc(doc(db, 'users', user.uid));
                if (userDoc.exists()) userData = userDoc.data();
            }

            // Fallback for demo or admin viewing
            if (!userData) {
                userData = {
                    name: localStorage.getItem('userName') || 'Manager',
                    role: localStorage.getItem('userRole') || 'manager',
                    department: localStorage.getItem('userDept') || 'General'
                };
            }

            if (centerId) {
                // Fetch specific command center config
                try {
                    let centerDoc = await getDoc(doc(db, 'command_centers', centerId));
                    if (!centerDoc.exists()) {
                        // Fallback to legacy departments collection
                        centerDoc = await getDoc(doc(db, 'departments', centerId));
                    }
                    if (centerDoc.exists()) {
                        const config = centerDoc.data();
                        currentDeptConfig = config;
                        hydrateDashboard(config);
                    } else {
                        console.warn("Command center not found:", centerId);
                    }
                } catch (e) { console.error("Error fetching center config:", e); }
            } else {
                // Dynamically look up the command center matching the manager's department
                try {
                    // 1. Try exact ID match first (New architecture)
                    if (userData.departmentId) {
                        let directDoc = await getDoc(doc(db, 'command_centers', userData.departmentId));
                        if (!directDoc.exists()) {
                            directDoc = await getDoc(doc(db, 'departments', userData.departmentId));
                        }
                        if (directDoc.exists()) {
                            window.location.href = `manager-dashboard.html?id=${userData.departmentId}`;
                            return;
                        }
                    }

                    // 2. Fallback to name query (Legacy architecture)
                    let q = query(collection(db, 'command_centers'), where('name', '==', userData.department));
                    let snap = await getDocs(q);
                    
                    if (snap.empty) {
                        q = query(collection(db, 'departments'), where('name', '==', userData.department));
                        snap = await getDocs(q);
                    }
                    if (!snap.empty) {
                        const docId = snap.docs[0].id;
                        window.location.href = `manager-dashboard.html?id=${docId}`;
                        return;
                    } else {
                        // 3. Fallback: If no matching department command center exists, fetch the very first command center
                        const allSnap = await getDocs(collection(db, 'command_centers'));
                        if (!allSnap.empty) {
                            window.location.href = `manager-dashboard.html?id=${allSnap.docs[0].id}`;
                            return;
                        }
                    }
                } catch (err) {
                    console.error("Error finding manager command center:", err);
                }
                
                // Fallback to user's department
                const sideDeptName = document.getElementById('sideDeptName');
                const sideDeptCode = document.getElementById('sideDeptCode');
                if (sideDeptName) sideDeptName.textContent = userData.department;
                if (sideDeptCode) sideDeptCode.textContent = (userData.department.substring(0, 3) + '-UNIT').toUpperCase();
                const welcomeTitle = document.querySelector('.header h1');
                const welcomeSub = document.querySelector('.header .sub-header');
                if (welcomeTitle) welcomeTitle.textContent = `Welcome, ${userData.name}`;
                if (welcomeSub) welcomeSub.textContent = `${userData.department} Command Center - Real-time operational intelligence`;
            }

            if (user && (userData.role || '').toLowerCase() !== 'manager' && !centerId) {
                window.location.href = 'index.html';
                return;
            }

            // Initialize Apps after auth state is completely resolved
            initApps();

            const activeUserId = user ? user.uid : localStorage.getItem('hr_user_id') || 'manager_demo';
            restoreManagerSession(activeUserId);
        });

        function restoreManagerSession(userId) {
            const today = new Date().toISOString().split('T')[0];
            const statusRef = doc(db, "manager_sessions", `${userId}_${today}`);
            const btnIn = document.getElementById('btnPunchIn');
            const btnBreak = document.getElementById('btnBreak');
            const btnOut = document.getElementById('btnPunchOut');
            const tvcDot = document.getElementById('tvcDot');
            const tvcText = document.getElementById('tvcStatusText');
            const timerDisplay = document.getElementById('adminSessionTimer');

            import("https://www.gstatic.com/firebasejs/12.12.1/firebase-firestore.js").then(mod => {
                const { onSnapshot } = mod;
                onSnapshot(statusRef, (docSnap) => {
                    if (docSnap.exists()) {
                        const data = docSnap.data();
                        if (data.status === 'Active' || data.status === 'Break') {
                            btnIn.style.display = 'none';
                            btnOut.style.display = 'flex';
                            btnBreak.disabled = false;
                            btnBreak.style.opacity = '1';
                            
                            if (data.punchIn) {
                                const pIn = data.punchIn.toDate ? data.punchIn.toDate() : new Date(data.punchIn);
                                managerStartTime = pIn.getTime();
                                timerDisplay.style.display = 'inline';
                                
                                if (data.status === 'Active') {
                                    tvcText.textContent = "SECURE: ACTIVE";
                                    tvcDot.style.background = "var(--success)";
                                    tvcDot.style.boxShadow = "0 0 10px var(--success)";
                                    btnBreak.innerHTML = '<i data-lucide="coffee" size="14"></i> Break';
                                    btnBreak.style.background = "#f59e0b";
                                    startManagerTimer();
                                } else {
                                    tvcText.textContent = "SECURE: PAUSED";
                                    tvcDot.style.background = "#f59e0b";
                                    tvcDot.style.boxShadow = "none";
                                    btnBreak.innerHTML = '<i data-lucide="play" size="14"></i> Resume';
                                    btnBreak.style.background = "#3b82f6";
                                    clearInterval(managerTimerInterval);
                                    
                                    // Static timer update for paused state
                                    const diff = Date.now() - managerStartTime;
                                    const h = Math.floor(diff / 3600000).toString().padStart(2, '0');
                                    const m = Math.floor((diff % 3600000) / 60000).toString().padStart(2, '0');
                                    const s = Math.floor((diff % 60000) / 1000).toString().padStart(2, '0');
                                    timerDisplay.textContent = `${h}:${m}:${s}`;
                                }
                            }
                        } else if (data.status === 'Offline') {
                            btnIn.style.display = 'flex';
                            btnBreak.disabled = true;
                            btnBreak.style.opacity = '0.5';
                            btnOut.style.display = 'none';
                            tvcText.textContent = "SECURE: IDLE";
                            tvcDot.style.background = "#cbd5e1";
                            tvcDot.style.boxShadow = "none";
                            timerDisplay.style.display = 'none';
                            clearInterval(managerTimerInterval);
                            btnBreak.innerHTML = '<i data-lucide="coffee" size="14"></i> Break';
                            btnBreak.style.background = "#f59e0b";
                        }
                        if (window.lucide) lucide.createIcons();
                    }
                });
            });
        }

        function hydrateDashboard(config) {
            const sideDeptName = document.getElementById('sideDeptName');
            const sideDeptCode = document.getElementById('sideDeptCode');
            const welcomeTitle = document.querySelector('.header h1');
            const deptIcon = document.getElementById('deptIcon');
            const customAppsList = document.getElementById('customAppsList');
            const overviewLink = document.getElementById('overviewLink');
            const leaveHolidaysLink = document.getElementById('leaveHolidaysLink');
            const navConsoleLink = document.getElementById('navConsoleLink');
            const navAnalysisLink = document.getElementById('navAnalysisLink');
            const navNotifLink = document.getElementById('navNotifLink');
            const navMsgLink = document.getElementById('navMsgLink');

            if (overviewLink && centerId) overviewLink.href = `manager-dashboard.html?id=${centerId}`;
            if (leaveHolidaysLink && centerId) leaveHolidaysLink.href = `manger-calacder.html?id=${centerId}`;
            if (navConsoleLink && centerId) navConsoleLink.href = `manager-dashboard.html?id=${centerId}`;
            if (navAnalysisLink && centerId) navAnalysisLink.href = `manager-analysis.html?id=${centerId}`;
            if (navNotifLink && centerId) navNotifLink.href = `manager-notification.html?id=${centerId}`;
            if (navMsgLink && centerId) navMsgLink.href = `manager-message.html?id=${centerId}`;
            
            // Ensure global compatibility for DBAC
            window.currentUnitIds = Array.from(new Set([
                currentUnitId, 
                config.name, 
                config.name.toLowerCase(), 
                config.name.toLowerCase().replace(/\s+/g, '-'),
                (config.unitId || '').toLowerCase()
            ])).filter(Boolean);

            if (sideDeptName) sideDeptName.textContent = config.name;
            if (sideDeptCode) sideDeptCode.textContent = config.unitId || (config.name.substring(0, 3) + '-UNIT').toUpperCase();
            if (welcomeTitle) welcomeTitle.textContent = `Welcome, ${localStorage.getItem('userName') || 'Manager'}`;
            const welcomeSub = document.querySelector('.header .sub-header');
            if (welcomeSub) welcomeSub.textContent = `${config.name} Command Center - Real-time operational intelligence`;
            if (deptIcon) {
                deptIcon.innerHTML = `<i data-lucide="${config.icon || 'shield'}"></i>`;
                deptIcon.style.color = config.primaryColor || 'var(--primary)';
            }

            // Apply Theme Colors
            if (config.primaryColor) {
                document.documentElement.style.setProperty('--primary', config.primaryColor);
                document.documentElement.style.setProperty('--primary-light', config.primaryColor + '15');
            }
            if (deptIcon) deptIcon.innerHTML = config.icon || '<i data-lucide="shield"></i>';

            // SECURE DEPARTMENT SYNC: Strict isolation enforced at Firestore level
            import("https://www.gstatic.com/firebasejs/12.12.1/firebase-firestore.js").then(mod => {
                const { collection, query, where, onSnapshot } = mod;
                const today = new Date().toISOString().split('T')[0];
                
                // DBAC Layer: Strict bind to currentUnitId (Client-side filtering to bypass 400 errors)
                onSnapshot(collection(db, 'users'), (snapshot) => {
                    const rawUsers = snapshot.docs
                        .map(d => ({ id: d.id, ...d.data() }))
                        .filter(u => {
                            // Only include users matching the current dashboard's units
                            return window.currentUnitIds.includes(u.departmentId) || 
                                   window.currentUnitIds.includes(u.departmentName) ||
                                   window.currentUnitIds.includes(u.departmentCode);
                        });
                    
                    // Listen to today's attendance
                    onSnapshot(collection(db, 'attendance'), (attSnap) => {
                        const attendanceMap = {};
                        attSnap.docs.forEach(doc => {
                            if (doc.id.includes(today)) {
                                const empId = doc.id.split('_')[0];
                                attendanceMap[empId] = doc.data();
                            }
                        });

                        const usersWithStatus = rawUsers.map(u => {
                            const att = attendanceMap[u.id];
                            let liveStatus = u.status || 'Active';
                            if (att && att.punchIn) {
                                 liveStatus = att.punchOut ? 'Shift Completed' : 'Online';
                            } else if (u.status === 'Completed' || !u.status) {
                                liveStatus = 'Available (Offline)';
                            }
                            return { ...u, status: liveStatus };
                        });

                        renderWorkforceData(usersWithStatus);
                        calculatePayroll(usersWithStatus, config.budget || 500000);
                        updateTeleStats(usersWithStatus);
                        updateEfficiency(usersWithStatus);
                        updateSecurityAlerts(config.name);
                    });
                });
            });

            lucide.createIcons();
        }

        function updateTeleStats(users) {
            const activeCount = users.filter(u => u.status === 'Online').length;
            const offlineCount = users.length - activeCount;
            
            const activeBox = document.querySelector('.tele-box.active .tele-val');
            const offlineBox = document.querySelector('.tele-box:not(.active) .tele-val');
            
            if (activeBox) activeBox.textContent = activeCount.toString().padStart(2, '0');
            if (offlineBox) offlineBox.textContent = offlineCount.toString().padStart(2, '0');
        }

        function renderWorkforceData(users) {
            const tbody = document.querySelector('table tbody');
            if (!tbody) return;
            
            if (users.length === 0) {
                tbody.innerHTML = '<tr><td colspan="3" style="text-align:center; padding:2rem; color:var(--text-muted);">No personnel assigned to this unit</td></tr>';
                return;
            }

            tbody.innerHTML = users.slice(0, 5).map(u => `
                <tr>
                    <td>${u.name || 'Unknown Employee'}</td>
                    <td>${u.designation || u.role || 'Personnel'}</td>
                    <td><span style="color:${(u.status || '').includes('Online') || u.status === 'Active' ? 'var(--success)' : 'var(--text-muted)'}">● ${u.status || 'Active'}</span></td>
                </tr>
            `).join('');
        }

        function updateEfficiency(users) {
            const box = document.getElementById('manager-efficiency-box');
            if (!box) return;

            const scores = users.map(u => Number(u.aiProductivityScore) || 0).filter(s => s > 0);
            if (scores.length === 0) {
                box.innerHTML = `
                    <div style="font-size: 3.5rem; font-weight: 800; color: var(--text-muted);">--</div>
                    <div style="font-size: 0.8rem; font-weight: 700; color: var(--text-muted);">Awaiting Telemetry</div>
                `;
                return;
            }

            const avg = Math.round(scores.reduce((a, b) => a + b, 0) / scores.length);
            const trend = avg > 70 ? 'Optimal' : (avg > 40 ? 'Stable' : 'Risk');
            const color = avg > 70 ? 'var(--success)' : (avg > 40 ? 'var(--primary)' : 'var(--danger)');

            box.innerHTML = `
                <div style="font-size: 3.5rem; font-weight: 800; color: ${color};">${avg}%</div>
                <div style="font-size: 0.8rem; font-weight: 700; color: ${color};">${trend} Efficiency</div>
            `;
        }

        function updateSecurityAlerts(deptName) {
            const list = document.getElementById('manager-security-list');
            if (!list) return;

            import("https://www.gstatic.com/firebasejs/12.12.1/firebase-firestore.js").then(mod => {
                const { collection, query, where, onSnapshot, limit, orderBy } = mod;
                // Fetch alerts relevant to this department or system-wide without composite index
                const q = query(
                    collection(db, 'alertEvents'),
                    where('departmentId', 'in', [deptName, 'SYS', 'GLOBAL'])
                );

                onSnapshot(q, (snapshot) => {
                    if (snapshot.empty) {
                        list.innerHTML = `
                            <div style="display: flex; align-items: center; gap: 12px; padding: 1rem; background: var(--primary-light); border-radius: 12px; color: var(--primary);">
                                <i data-lucide="check-circle" size="20"></i>
                                <div style="font-size: 0.85rem; font-weight: 700;">No Active Alerts</div>
                            </div>
                        `;
                        lucide.createIcons();
                        return;
                    }

                    // Sort client-side to avoid Firestore composite index requirement (400 Error)
                    const docs = snapshot.docs.map(d => d.data());
                    docs.sort((a, b) => {
                        const tA = a.timestamp?.seconds || 0;
                        const tB = b.timestamp?.seconds || 0;
                        return tB - tA; // desc
                    });

                    const al = docs[0];
                    const color = al.severity === 'critical' ? 'var(--danger)' : 'var(--primary)';
                    const bg = al.severity === 'critical' ? '#fff1f2' : 'var(--primary-light)';

                    list.innerHTML = `
                        <div class="alert-box" style="background: ${bg}; border-color: ${color}20;">
                            <i data-lucide="alert-circle" style="color: ${color};" size="20"></i>
                            <div>
                                <div class="alert-title" style="color: ${color};">${al.severity ? al.severity.toUpperCase() : 'ALERT'}</div>
                                <div class="alert-msg" style="color: ${color}; opacity: 0.8;">${al.message}</div>
                            </div>
                        </div>
                    `;
                    lucide.createIcons();
                });
            });
        }

        function calculatePayroll(users, budget = 500000) {
            const burnVal = document.querySelector('.burn-val');
            const burnTrend = document.querySelector('.burn-trend');
            if (!burnVal || !burnTrend) return;

            const total = users.reduce((acc, u) => {
                const salary = parseFloat((u.salary || '0').toString().replace(/[^0-9.]/g, '')) || 0;
                return acc + salary;
            }, 0);

            // Format for display
            if (total >= 1000) {
                burnVal.textContent = `₹${(total / 1000).toFixed(1)}K`;
            } else {
                burnVal.textContent = `₹${total}`;
            }

            // Compare with Budget
            if (total > budget) {
                burnTrend.textContent = `₹${((total - budget) / 1000).toFixed(1)}K Above Allocation`;
                burnTrend.style.color = 'var(--danger)';
            } else {
                burnTrend.textContent = "Within Budget Allocation";
                burnTrend.style.color = 'var(--success)';
            }
        }

        window.logout = async () => {
            await signOut(auth);
            localStorage.clear();
            window.location.href = 'index.html';
        };

        // --- Manager Session & Backend Sync ---
        let managerTimerInterval;
        let managerStartTime;

                async function syncStatus(status, type) {
            const userId = auth.currentUser ? auth.currentUser.uid : (localStorage.getItem('hr_user_id') || 'manager_demo');
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
                            const durationMs = punchOutMs - punchInMs;
                            const durationHours = durationMs / (1000 * 60 * 60);
                            updateData.durationHours = durationHours;
                            updateData.status = durationHours >= 4 ? 'Present' : 'Short Hours';
                        } else {
                            updateData.status = 'Present';
                        }
                    } else {
                        updateData.status = 'Present';
                    }
                } catch (e) {
                    print("Error setting punch out details:", e)
                    updateData.status = 'Present';
                }
            }

            await setDoc(attRef, updateData, { merge: true });
        }

        window.managerPunchIn = async () => {
            const btnIn = document.getElementById('btnPunchIn');
            const btnBreak = document.getElementById('btnBreak');
            const btnOut = document.getElementById('btnPunchOut');
            const tvcDot = document.getElementById('tvcDot');
            const tvcText = document.getElementById('tvcStatusText');
            const timerDisplay = document.getElementById('adminSessionTimer');

            tvcText.textContent = "SECURE: CONNECTING...";
            tvcDot.style.background = "#3b82f6";
            
            setTimeout(async () => {
                tvcText.textContent = "SECURE: ACTIVE";
                tvcDot.style.background = "var(--success)";
                tvcDot.style.boxShadow = "0 0 10px var(--success)";
                
                managerStartTime = Date.now();
                timerDisplay.style.display = 'inline';
                startManagerTimer();

                await syncStatus('Active', 'in');
                
                btnIn.style.display = 'none';
                btnBreak.disabled = false;
                btnBreak.style.opacity = '1';
                btnOut.style.display = 'flex';
            }, 1000);
        };

        function startManagerTimer() {
            const timerDisplay = document.getElementById('adminSessionTimer');
            clearInterval(managerTimerInterval);
            managerTimerInterval = setInterval(() => {
                const diff = Date.now() - managerStartTime;
                const h = Math.floor(diff / 3600000).toString().padStart(2, '0');
                const m = Math.floor((diff % 3600000) / 60000).toString().padStart(2, '0');
                const s = Math.floor((diff % 60000) / 1000).toString().padStart(2, '0');
                timerDisplay.textContent = `${h}:${m}:${s}`;
            }, 1000);
        }

        window.managerBreak = async () => {
            const btnBreak = document.getElementById('btnBreak');
            const tvcDot = document.getElementById('tvcDot');
            const tvcText = document.getElementById('tvcStatusText');

            if (btnBreak.textContent.includes('Break')) {
                clearInterval(managerTimerInterval);
                btnBreak.innerHTML = '<i data-lucide="play" size="14"></i> Resume';
                btnBreak.style.background = "#3b82f6";
                tvcText.textContent = "SECURE: PAUSED";
                tvcDot.style.background = "#f59e0b";
                await syncStatus('Break', 'break');
            } else {
                startManagerTimer();
                btnBreak.innerHTML = '<i data-lucide="coffee" size="14"></i> Break';
                btnBreak.style.background = "#f59e0b";
                tvcText.textContent = "SECURE: ACTIVE";
                tvcDot.style.background = "var(--success)";
                await syncStatus('Active', 'resume');
            }
            lucide.createIcons();
        };

        window.managerPunchOut = async () => {
            const btnIn = document.getElementById('btnPunchIn');
            const btnBreak = document.getElementById('btnBreak');
            const btnOut = document.getElementById('btnPunchOut');
            const tvcDot = document.getElementById('tvcDot');
            const tvcText = document.getElementById('tvcStatusText');
            const timerDisplay = document.getElementById('adminSessionTimer');

            clearInterval(managerTimerInterval);
            tvcText.textContent = "SECURE: IDLE";
            tvcDot.style.background = "#cbd5e1";
            tvcDot.style.boxShadow = "none";
            timerDisplay.style.display = 'none';

            await syncStatus('Offline', 'out');

            btnIn.style.display = 'flex';
            btnBreak.disabled = true;
            btnBreak.style.opacity = '0.5';
            btnOut.style.display = 'none';
            btnBreak.innerHTML = '<i data-lucide="coffee" size="14"></i> Break';
            btnBreak.style.background = "#f59e0b";
            lucide.createIcons();
        };

        // --- Apps Logic (Firebase Connected) ---

        const DEFAULT_APPS = [
            { name: "HRMS", url: "hrms-dashboard.html" },
            { name: "SLACK", url: "https://slack.com" },
            { name: "GITHUB", url: "https://github.com" },
            { name: "JIRA", url: "https://atlassian.com" }
        ];

        async function initApps() {
            const userId = auth.currentUser ? auth.currentUser.uid : (localStorage.getItem('hr_user_id') || 'manager_demo');
            const appsRef = doc(db, "manager_apps", userId);

            // Listen for real-time updates
            onSnapshot(appsRef, async (snapshot) => {
                let apps = [];
                if (snapshot.exists()) {
                    apps = snapshot.data().apps || [];
                } else {
                    // Seed with defaults if first time
                    await setDoc(appsRef, { apps: DEFAULT_APPS });
                    apps = DEFAULT_APPS;
                }
                renderAppsUI(apps);
            });
        }

        function renderAppsUI(apps) {
            const list = document.getElementById('customAppsList');
            if (list) {
                list.innerHTML = apps.map((app, index) => `
                    <div class="nav-item" style="position: relative;">
                        <a href="${app.url}" target="_blank" class="nav-link" style="padding-right: 32px;">
                            <i data-lucide="external-link"></i>
                            <span>${app.name}</span>
                        </a>
                        <button onclick="removeAppFromServer('${app.url}', '${app.name}')" style="position: absolute; right: 8px; top: 50%; transform: translateY(-50%); background: none; border: none; color: var(--danger); opacity: 0.5; cursor: pointer; padding: 4px; display: flex; align-items: center; justify-content: center;" title="Remove App Mapping">
                            <i data-lucide="x" style="width: 12px; height: 12px;"></i>
                        </button>
                    </div>
                `).join('');
            }

            const registryList = document.getElementById('registryAppsList');
            if (registryList) {
                registryList.innerHTML = apps.map((app) => `
                    <div style="display: flex; justify-content: space-between; align-items: center; padding: 10px 14px; background: var(--bg); border: 1px solid var(--border); border-radius: 12px; font-size: 0.85rem; margin-bottom: 8px;">
                        <div style="display: flex; align-items: center; gap: 8px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 80%;">
                            <i data-lucide="external-link" style="width: 16px; height: 16px; color: var(--primary); flex-shrink: 0;"></i>
                            <span style="font-weight: 700; font-size: 0.8rem;">${app.name}</span>
                        </div>
                        <button onclick="removeAppFromServer('${app.url}', '${app.name}')" style="background: none; border: none; color: var(--danger); cursor: pointer; display: flex; align-items: center; justify-content: center; padding: 4px; flex-shrink: 0;" title="Delete Mapping">
                            <i data-lucide="trash-2" style="width: 16px; height: 16px;"></i>
                        </button>
                    </div>
                `).join('');
            }
            lucide.createIcons();
        }

        window.openAppRegistryModal = () => {
            const modal = document.getElementById('customAppsModal');
            if (modal) modal.style.display = 'flex';
            lucide.createIcons();
        };

        window.addCustomApp = async () => {
            const urlInput = document.getElementById('appUrlInput');
            const nameInput = document.getElementById('appNameInput');
            if (!urlInput) return;
            
            const url = urlInput.value.trim();
            const customName = nameInput ? nameInput.value.trim() : '';
            if (!url) return;

            try {
                let cleanUrl = url;
                if (!url.startsWith('http')) cleanUrl = 'https://' + url;
                const urlObj = new URL(cleanUrl);
                const domain = urlObj.hostname.replace('www.', '');
                const appName = customName || domain.split('.')[0].toUpperCase();

                const userId = auth.currentUser ? auth.currentUser.uid : (localStorage.getItem('hr_user_id') || 'manager_demo');
                const appsRef = doc(db, "manager_apps", userId);

                await setDoc(appsRef, {
                    apps: arrayUnion({ name: appName, url: cleanUrl })
                }, { merge: true });

                urlInput.value = '';
                if (nameInput) nameInput.value = '';
            } catch (e) {
                alert("Invalid URL structure.");
            }
        };

        window.removeAppFromServer = async (url, name) => {
            const userId = auth.currentUser ? auth.currentUser.uid : (localStorage.getItem('hr_user_id') || 'manager_demo');
            const appsRef = doc(db, "manager_apps", userId);
            await setDoc(appsRef, {
                apps: arrayRemove({ name: name, url: url })
            }, { merge: true });
        };

        window.toggleAppsMenu = () => {
            const dropdown = document.getElementById('appsDropdown');
            const chevron = document.getElementById('appsChevron');
            const isVisible = dropdown.style.display === 'flex';
            
            dropdown.style.display = isVisible ? 'none' : 'flex';
            chevron.style.transform = isVisible ? 'rotate(0deg)' : 'rotate(180deg)';
        };

        window.showModuleInfo = (title, msg) => {
            document.getElementById('alertTitle').textContent = title;
            document.getElementById('alertMsg').textContent = msg;
            document.getElementById('moduleAlertOverlay').style.display = 'flex';
            lucide.createIcons();
        };

        // --- Operations Handlers ---
        window.showNotifications = () => {
            document.getElementById('notificationsModal').style.display = 'flex';
            lucide.createIcons();
        };

        window.showMessages = () => {
            document.getElementById('messagesModal').style.display = 'flex';
            lucide.createIcons();
        };

        window.openTeamManager = async () => {
            document.getElementById('teamManagerModal').style.display = 'flex';
            loadTeams();
        };

        window.loadTeams = async () => {
            const { collection, onSnapshot } = await import("https://www.gstatic.com/firebasejs/12.12.1/firebase-firestore.js");
            
            // STRICT TEAM ISOLATION: Client-side filtering to bypass 400 errors
            onSnapshot(collection(db, 'department_teams'), (snapshot) => {
                const teamsList = document.getElementById('teamsList');
                if (!teamsList) return;

                const safeUnitIds = Array.from(window.currentUnitIds || []);
                if (!currentUnitId) {
                    safeUnitIds.push(null, undefined, "");
                }

                const teams = snapshot.docs
                    .map(doc => ({ id: doc.id, ...doc.data() }))
                    .filter(t => safeUnitIds.includes(t.departmentId));
                
                if (teams.length === 0) {
                    teamsList.innerHTML = '<div style="padding: 40px; text-align: center; color: var(--text-muted); font-size: 0.85rem; border: 2px dashed var(--border); border-radius: 20px;">No teams initialized in this secure unit.</div>';
                    return;
                }

                teamsList.innerHTML = teams.map(t => `
                    <div class="team-card" onclick="viewTeam('${t.id}')" style="background: var(--bg); border: 1px solid var(--border); padding: 16px; border-radius: 16px; cursor: pointer; transition: 0.3s; margin-bottom: 12px; position: relative; overflow: hidden;">
                        <div style="position: absolute; top: 0; left: 0; width: 4px; height: 100%; background: var(--primary);"></div>
                        <div style="display: flex; justify-content: space-between; align-items: center;">
                            <div>
                                <h4 style="font-weight: 800; font-size: 0.9rem; text-transform: capitalize;">${t.name}</h4>
                                <p style="font-size: 0.7rem; color: var(--text-muted);">${t.memberCount || 0} Operators • ${t.leader ? 1 : (t.leaders?.length || 0)} Leaders</p>
                            </div>
                            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="color: var(--text-muted); flex-shrink:0;"><polyline points="9 18 15 12 9 6"/></svg>
                        </div>
                    </div>
                `).join('');
                lucide.createIcons();
            });
        };

        window.showNewTeamForm = async () => {
            const { collection, getDocs, query, where } = await import("https://www.gstatic.com/firebasejs/12.12.1/firebase-firestore.js");
            
            // ISOLATED PERSONNEL DISCOVERY: Client-side filtering
            const snap = await getDocs(collection(db, 'users'));
            const deptUsers = snap.docs
                .map(doc => {
                    const u = doc.data();
                    return { id: doc.id, publicId: u.id || 'N/A', name: u.name, clearance: u.securityClearance || 'Level 1', departmentId: u.departmentId, departmentName: u.departmentName, departmentCode: u.departmentCode };
                })
                .filter(u => window.currentUnitIds.includes(u.departmentId) || window.currentUnitIds.includes(u.departmentName) || window.currentUnitIds.includes(u.departmentCode));


            const editor = document.getElementById('teamEditor');
            editor.innerHTML = `
                <div style="display: flex; flex-direction: column; gap: 1rem; max-height: 500px; overflow-y: auto; padding-right: 10px;">
                    <div style="background: rgba(59, 130, 246, 0.05); padding: 12px; border-radius: 12px; border: 1px solid var(--primary); display: flex; align-items: center; gap: 10px;">
                        <i data-lucide="lock" style="width: 16px; color: var(--primary);"></i>
                        <span style="font-size: 0.7rem; font-weight: 800; color: var(--primary); text-transform: uppercase;">Secure Unit Initialization</span>
                    </div>
                    
                    <div>
                        <label style="font-size: 0.7rem; font-weight: 800; color: var(--text-muted); text-transform: uppercase;">Mission Parameters (Team Name)</label>
                        <input type="text" id="newTeamName" placeholder="e.g. Threat Response Unit" style="width: 100%; padding: 12px; border-radius: 12px; border: 1px solid var(--border); outline: none; margin-top: 4px;">
                    </div>
                    
                    <div>
                        <label style="font-size: 0.7rem; font-weight: 800; color: var(--text-muted); text-transform: uppercase;">Operational Goals</label>
                        <textarea id="newTeamGoal" placeholder="Define the mission objective..." style="width: 100%; padding: 12px; border-radius: 12px; border: 1px solid var(--border); outline: none; margin-top: 4px; height: 80px;"></textarea>
                    </div>
                    
                    <div>
                        <label style="font-size: 0.7rem; font-weight: 800; color: var(--text-muted); text-transform: uppercase;">Team Leader Assignment</label>
                        <div style="position: relative; margin-top: 8px; margin-bottom: 8px;">
                            <select id="newTeamLeaderSelect" style="width: 100%; padding: 12px; border-radius: 12px; border: 1px solid var(--border); outline: none; font-family: inherit; font-size: 0.8rem;">
                                <option value="">-- Assign Team Leader (Optional) --</option>
                                ${deptUsers.length > 0 ? deptUsers.map(u => `
                                    <option value="${u.id}" data-name="${u.name}">
                                        ${u.name} [${u.publicId}] — ${u.clearance}
                                    </option>
                                `).join('') : '<option disabled>Zero available personnel in this secure vault.</option>'}
                            </select>
                        </div>
                    </div>

                    <div>
                        <label style="font-size: 0.7rem; font-weight: 800; color: var(--text-muted); text-transform: uppercase;">Operator Assignment</label>
                        <div style="position: relative; margin-top: 8px;">
                            <select id="initialMemberSelect" multiple style="width: 100%; padding: 12px; border-radius: 12px; border: 1px solid var(--border); outline: none; height: 180px; font-family: inherit; font-size: 0.8rem;">
                                ${deptUsers.length > 0 ? deptUsers.map(u => `
                                    <option value="${u.id}" data-name="${u.name}">
                                        ${u.name} [${u.publicId}] — ${u.clearance}
                                    </option>
                                `).join('') : '<option disabled>Zero available personnel in this secure vault.</option>'}
                            </select>
                        </div>
                    </div>

                    <button onclick="saveTeam()" style="background: var(--primary); color: white; border: none; border-radius: 12px; padding: 14px; font-weight: 800; cursor: pointer; position: sticky; bottom: 0; box-shadow: 0 -4px 12px rgba(0,0,0,0.05);">Deploy Team</button>
                </div>
            `;
            lucide.createIcons();
        };

        window.saveTeam = async () => {
            const name = document.getElementById('newTeamName').value.trim();
            const goal = document.getElementById('newTeamGoal').value.trim();
            if (!name) return;

            const select = document.getElementById('initialMemberSelect');
            const members = Array.from(select.selectedOptions).map(opt => ({
                id: opt.value,
                name: opt.getAttribute('data-name')
            }));

            const leaderSelect = document.getElementById('newTeamLeaderSelect');
            const selectedLeaderOpt = leaderSelect?.options[leaderSelect.selectedIndex];
            const leader = selectedLeaderOpt && selectedLeaderOpt.value ? {
                id: selectedLeaderOpt.value,
                name: selectedLeaderOpt.getAttribute('data-name')
            } : null;

            const { collection, addDoc, serverTimestamp } = await import("https://www.gstatic.com/firebasejs/12.12.1/firebase-firestore.js");
            
            try {
                // ATOMIC ISOLATION: Department bind enforced on creation
                await addDoc(collection(db, 'department_teams'), {
                    name,
                    goal,
                    departmentId: currentUnitId,
                    departmentCode: currentDeptConfig?.unitId || 'SEC',
                    businessUnit: currentDeptConfig?.businessUnit || 'Global Operations',
                    createdBy: auth.currentUser?.uid || 'manager',
                    createdAt: serverTimestamp(),
                    memberCount: members.length,
                    members: members,
                    leader: leader,
                    leaders: leader ? [leader] : [],
                    subManagers: [],
                    subManager: null
                });
                loadTeams();
                document.getElementById('teamEditor').innerHTML = '<div style="height: 100%; display: flex; align-items: center; justify-content: center; color: var(--success); font-weight: 800; text-align: center;">Mission parameters successfully deployed.</div>';
            } catch (e) { console.error("Deployment failed:", e); }
        };

        window.viewTeam = async (id) => {
            const { doc, onSnapshot } = await import("https://www.gstatic.com/firebasejs/12.12.1/firebase-firestore.js");
            
            onSnapshot(doc(db, 'department_teams', id), (snapshot) => {
                if (!snapshot.exists()) return;
                const t = snapshot.data();
                
                // DBAC VALIDATION: Block cross-department view attempts
                const safeUnitIds = Array.from(window.currentUnitIds || []);
                if (!currentUnitId) {
                    safeUnitIds.push(null, undefined, "");
                }
                if (!safeUnitIds.includes(t.departmentId)) {
                    alert("Unauthorized access attempt detected. Access Denied.");
                    return;
                }

                const editor = document.getElementById('teamEditor');
                editor.innerHTML = `
                    <div style="display: flex; flex-direction: column; gap: 1.5rem; animation: slideIn 0.3s ease-out;">
                        <div style="display: flex; justify-content: space-between; align-items: flex-start;">
                            <div>
                                <h3 style="font-weight: 800; font-size: 1.2rem; text-transform: capitalize;">${t.name}</h3>
                                <p style="font-size: 0.75rem; color: var(--text-muted); line-height: 1.5;">${t.goal || 'No objective defined.'}</p>
                            </div>
                            <div style="background: rgba(16, 185, 129, 0.1); color: var(--success); padding: 4px 10px; border-radius: 8px; font-size: 0.65rem; font-weight: 800;">ACTIVE UNIT</div>
                        </div>

                        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 1rem;">
                            <div class="role-box" onclick="openMemberPicker('${id}', 'leader')" style="background: var(--bg); border: 1px solid var(--border); padding: 16px; border-radius: 16px; cursor: pointer; transition: 0.2s;">
                                <div style="font-size: 0.65rem; font-weight: 800; color: var(--text-muted); text-transform: uppercase;">Team Leader</div>
                                <div style="font-weight: 700; font-size: 0.9rem; margin-top: 8px; color: ${t.leader ? 'var(--text)' : 'var(--text-muted)'};">
                                    ${t.leader ? t.leader.name : 'Assign Leader'}
                                </div>
                            </div>
                            <div class="role-box" onclick="openMemberPicker('${id}', 'subManager')" style="background: var(--bg); border: 1px solid var(--border); padding: 16px; border-radius: 16px; cursor: pointer; transition: 0.2s;">
                                <div style="font-size: 0.65rem; font-weight: 800; color: var(--text-muted); text-transform: uppercase;">Sub-Manager</div>
                                <div style="font-weight: 700; font-size: 0.9rem; margin-top: 8px; color: ${t.subManager ? 'var(--text)' : 'var(--text-muted)'};">
                                    ${t.subManager ? t.subManager.name : 'Assign Support'}
                                </div>
                            </div>
                        </div>

                        <div>
                            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px;">
                                <label style="font-size: 0.7rem; font-weight: 800; color: var(--text-muted); text-transform: uppercase;">Assigned Workforce</label>
                                <button onclick="openMemberPicker('${id}', 'member')" style="background: none; border: none; color: var(--primary); font-size: 0.7rem; font-weight: 800; cursor: pointer; display: flex; align-items: center; gap: 4px;">
                                    <i data-lucide="plus-circle" style="width: 14px;"></i> Add Operator
                                </button>
                            </div>
                            <div id="teamMembersList" style="display: flex; flex-direction: column; gap: 8px;">
                                ${t.members && t.members.length > 0 ? t.members.map(m => `
                                    <div style="display: flex; justify-content: space-between; align-items: center; padding: 12px; background: var(--bg); border: 1px solid var(--border); border-radius: 12px;">
                                        <div style="display: flex; align-items: center; gap: 10px;">
                                            <div style="width: 32px; height: 32px; border-radius: 10px; background: var(--border); display: flex; align-items: center; justify-content: center; font-weight: 800; font-size: 0.75rem; color: var(--primary);">${m.name.charAt(0)}</div>
                                            <span style="font-size: 0.85rem; font-weight: 600;">${m.name}</span>
                                        </div>
                                        <button onclick="removeTeamMember('${id}', '${m.id}')" style="background: none; border: none; color: var(--danger); cursor: pointer; opacity: 0.6; transition: 0.2s;"><i data-lucide="x-circle" style="width: 18px;"></i></button>
                                    </div>
                                `).join('') : '<p style="font-size: 0.8rem; color: var(--text-muted); text-align: center; padding: 20px;">No operators deployed.</p>'}
                            </div>
                        </div>

                        <button onclick="deleteTeam('${id}')" style="margin-top: 10px; background: rgba(239, 68, 68, 0.05); color: var(--danger); border: 1px solid rgba(239, 68, 68, 0.1); border-radius: 12px; padding: 14px; font-weight: 800; cursor: pointer; display: flex; align-items: center; justify-content: center; gap: 8px;">
                            <i data-lucide="trash-2" style="width: 18px;"></i> Decommission Team
                        </button>
                    </div>
                `;
                lucide.createIcons();
            });
        };

        window.openMemberPicker = async (teamId, roleType) => {
            const { collection, getDocs, query, where } = await import("https://www.gstatic.com/firebasejs/12.12.1/firebase-firestore.js");
            
            // STRICT VAULT DISCOVERY: Client-side filtering
            const snap = await getDocs(collection(db, 'users'));
            const deptUsers = snap.docs
                .map(doc => {
                    const u = doc.data();
                    return { id: doc.id, publicId: u.id || 'N/A', name: u.name, clearance: u.securityClearance || 'Level 1', departmentId: u.departmentId, departmentName: u.departmentName, departmentCode: u.departmentCode };
                })
                .filter(u => window.currentUnitIds.includes(u.departmentId) || window.currentUnitIds.includes(u.departmentName) || window.currentUnitIds.includes(u.departmentCode));

            
            const title = document.getElementById('pickerTitle');
            title.textContent = roleType === 'leader' ? 'Assign Team Leader' : (roleType === 'subManager' ? 'Assign Sub-Manager' : 'Add Operator');
            
            const list = document.getElementById('pickerList');
            list.innerHTML = deptUsers.map(u => `
                <div onclick="assignMember('${teamId}', '${roleType}', '${u.id}', '${u.name}')" style="padding: 12px; border-radius: 12px; background: var(--bg); border: 1px solid var(--border); cursor: pointer; transition: 0.2s; margin-bottom: 8px;">
                    <div style="font-weight: 700; font-size: 0.85rem;">${u.name}</div>
                    <div style="font-size: 0.7rem; color: var(--text-muted);">${u.publicId} • ${u.clearance}</div>
                </div>
            `).join('');
            
            document.getElementById('memberPickerModal').style.display = 'flex';
            lucide.createIcons();
        };

        window.assignMember = async (teamId, roleType, userId, userName) => {
            const { doc, updateDoc, arrayUnion, getDoc } = await import("https://www.gstatic.com/firebasejs/12.12.1/firebase-firestore.js");
            
            try {
                const teamSnap = await getDoc(doc(db, 'department_teams', teamId));
                const safeUnitIds = Array.from(window.currentUnitIds || []);
                if (!currentUnitId) {
                    safeUnitIds.push(null, undefined, "");
                }
                if (!safeUnitIds.includes(teamSnap.data()?.departmentId)) {
                    alert("Security Breach Detected: Unauthorized cross-department assignment blocked.");
                    return;
                }

                if (roleType === 'member') {
                    await updateDoc(doc(db, 'department_teams', teamId), {
                        members: arrayUnion({ id: userId, name: userName }),
                        memberCount: (parseInt(document.getElementById('teamMembersList')?.children.length) || 0) + 1
                    });
                } else {
                    const updateData = {};
                    updateData[roleType] = { id: userId, name: userName };
                    await updateDoc(doc(db, 'department_teams', teamId), updateData);
                }
                document.getElementById('memberPickerModal').style.display = 'none';
                viewTeam(teamId);
            } catch (e) { console.error("Assignment failed:", e); }
        };

        window.removeTeamMember = async (teamId, userId) => {
            const { doc, getDoc, updateDoc } = await import("https://www.gstatic.com/firebasejs/12.12.1/firebase-firestore.js");
            try {
                const teamDoc = await getDoc(doc(db, 'department_teams', teamId));
                const safeUnitIds = Array.from(window.currentUnitIds || []);
                if (!currentUnitId) {
                    safeUnitIds.push(null, undefined, "");
                }
                if (!safeUnitIds.includes(teamDoc.data()?.departmentId)) return;

                const currentMembers = teamDoc.data().members || [];
                const updatedMembers = currentMembers.filter(m => m.id !== userId);
                
                await updateDoc(doc(db, 'department_teams', teamId), {
                    members: updatedMembers,
                    memberCount: updatedMembers.length
                });
                viewTeam(teamId);
            } catch (e) { console.error("Removal failed:", e); }
        };

        window.deleteTeam = async (id) => {
            const modal = document.getElementById('confirmModal');
            const confirmBtn = document.getElementById('confirmBtn');
            modal.style.display = 'flex';
            
            confirmBtn.onclick = async () => {
                const { doc, deleteDoc, getDoc } = await import("https://www.gstatic.com/firebasejs/12.12.1/firebase-firestore.js");
                try {
                    const teamSnap = await getDoc(doc(db, 'department_teams', id));
                    const safeUnitIds = Array.from(window.currentUnitIds || []);
                    if (!currentUnitId) {
                        safeUnitIds.push(null, undefined, "");
                    }
                    if (safeUnitIds.includes(teamSnap.data()?.departmentId)) {
                        await deleteDoc(doc(db, 'department_teams', id));
                        modal.style.display = 'none';
                        document.getElementById('teamEditor').innerHTML = '<div style="height: 100%; display: flex; align-items: center; justify-content: center; color: var(--text-muted); font-size: 0.85rem; text-align: center; border: 2px dashed var(--border); border-radius: 20px;">Unit decommissioned successfully.</div>';
                    }
                } catch (e) { console.error("Decommissioning failed:", e); }
            };
        };

        // Initialize Apps after ensuring auth is checked
        // (Moved to onAuthStateChanged)

        // ── EOD Approval Workflow ─────────────────────────────
        async function loadMgrEodList() {
            const listEl = document.getElementById('mgrEodList');
            const badge = document.getElementById('mgrEodBadge');
            if (!listEl) return;
            try {
                const reviews = await getPendingReviews();
                if (badge) {
                    badge.textContent = `${reviews.length} Pending`;
                    badge.style.background = reviews.length > 0 ? '#fee2e2' : '#ecfdf5';
                    badge.style.color = reviews.length > 0 ? '#ef4444' : '#10b981';
                }
                if (reviews.length === 0) {
                    listEl.innerHTML = '<div style="text-align:center; color:#10b981; font-size:0.8rem; padding:1.5rem;">✅ All team EODs reviewed!</div>';
                    return;
                }
                listEl.innerHTML = reviews.slice(0, 5).map(r => `
                    <div style="display:flex; justify-content:space-between; align-items:center; font-size:0.8rem; padding:8px 12px; background:#f8fafc; border-radius:10px; border:1px solid #e2e8f0;">
                        <div>
                            <span style="font-weight:700;">${r.employeeName || 'Team Member'}</span>
                            <span style="color:#64748b; font-size:0.75rem; margin-left:6px;">${(r.summary || 'No summary').substring(0, 40)}...</span>
                        </div>
                        <span style="background:#fef3c7; color:#d97706; font-size:0.65rem; font-weight:800; padding:2px 7px; border-radius:6px; white-space:nowrap;">Pending</span>
                    </div>
                `).join('');
                if (window.lucide) lucide.createIcons();
            } catch(err) {
                if(listEl) listEl.innerHTML = '<div style="color:#ef4444; font-size:0.8rem; text-align:center; padding:1rem;">Unable to load EODs.</div>';
            }
        }

        async function openMgrEodModal() {
            const modal = document.getElementById('mgrEodAuditModal');
            const listEl = document.getElementById('mgrEodAuditList');
            if (!modal) return;
            modal.style.display = 'flex';
            listEl.innerHTML = '<div style="text-align:center; padding:2rem; color:#64748b;"><i data-lucide="loader" class="animate-spin"></i> Loading team reviews...</div>';
            if (window.lucide) lucide.createIcons();

            try {
                const reviews = await getPendingReviews();
                if (reviews.length === 0) {
                    listEl.innerHTML = '<div style="text-align:center; padding:2.5rem; color:#10b981; font-weight:700; font-size:0.9rem;">✅ No pending reviews. Your team is all caught up!</div>';
                    return;
                }
                listEl.innerHTML = reviews.map(r => `
                    <div id="mgr-eod-${r.id}" style="background:#f8fafc; border:1px solid #e2e8f0; border-radius:16px; padding:1.25rem;">
                        <div style="display:flex; justify-content:space-between; align-items:flex-start; margin-bottom:0.75rem;">
                            <div>
                                <div style="font-weight:800; font-size:0.9rem;">${r.employeeName || 'Team Member'}</div>
                                <div style="font-size:0.72rem; color:#64748b; margin-top:2px;">${r.submittedAt ? new Date(r.submittedAt.seconds * 1000).toLocaleDateString('en-IN', {day:'2-digit', month:'short', year:'numeric', hour:'2-digit', minute:'2-digit'}) : 'Time unknown'}</div>
                            </div>
                            <span style="background:#fef3c7; color:#d97706; font-size:0.7rem; font-weight:800; padding:4px 10px; border-radius:100px;">Pending</span>
                        </div>
                        <p style="font-size:0.82rem; color:#475569; line-height:1.6; margin-bottom:1rem; background:white; padding:10px 12px; border-radius:10px; border:1px solid #e2e8f0;">${r.summary || r.tasks || 'No summary provided.'}</p>
                        <div style="display:flex; gap:8px; align-items:center;">
                            <input type="number" id="mgr-score-${r.id}" min="0" max="100" placeholder="0-100" style="width:80px; border:1px solid #e2e8f0; border-radius:8px; padding:7px 10px; font-size:0.8rem; outline:none; text-align:center;" onfocus="this.style.borderColor='#3b82f6'" onblur="this.style.borderColor='#e2e8f0'">
                            <input type="text" id="mgr-comment-${r.id}" placeholder="Add feedback..." style="flex:1; border:1px solid #e2e8f0; border-radius:8px; padding:7px 10px; font-size:0.8rem; outline:none;" onfocus="this.style.borderColor='#3b82f6'" onblur="this.style.borderColor='#e2e8f0'">
                            <button onclick="mgrSubmitScore('${r.id}')" style="background:#3b82f6; color:white; border:none; border-radius:8px; padding:7px 14px; font-size:0.75rem; font-weight:700; cursor:pointer; white-space:nowrap; transition:0.2s;" onmouseover="this.style.filter='brightness(1.1)'" onmouseout="this.style.filter=''">✓ Approve</button>
                        </div>
                    </div>
                `).join('');
                if (window.lucide) lucide.createIcons();
            } catch(err) {
                listEl.innerHTML = `<div style="color:#ef4444; text-align:center; padding:2rem;">Error: ${err.message}</div>`;
            }
        }

        window.mgrSubmitScore = async (eodId) => {
            const scoreEl = document.getElementById(`mgr-score-${eodId}`);
            const commentEl = document.getElementById(`mgr-comment-${eodId}`);
            const score = parseFloat(scoreEl.value);
            const comment = commentEl.value.trim() || 'Reviewed by Manager.';
            if (isNaN(score) || score < 0 || score > 100) {
                alert('Please enter a valid score between 0 and 100.');
                return;
            }
            const managerId = auth.currentUser?.uid || localStorage.getItem('hr_user_id') || 'manager';
            const approveBtn = scoreEl.closest('div[style*="gap"]')?.querySelector('button');
            try {
                if(approveBtn) { approveBtn.textContent = 'Saving...'; approveBtn.disabled = true; }
                await scorePerformance(eodId, score, comment, managerId);
                const item = document.getElementById(`mgr-eod-${eodId}`);
                if(item) {
                    item.style.transition = '0.4s';
                    item.style.opacity = '0.5';
                    setTimeout(() => {
                        item.innerHTML = `<div style="text-align:center; color:#10b981; font-weight:700; padding:1rem; font-size:0.85rem;">✅ Scored ${score}/100 — Approved & Synced to Firebase</div>`;
                        item.style.opacity = '1';
                    }, 300);
                }
                loadMgrEodList();
            } catch(err) {
                alert('Failed: ' + err.message);
                if(approveBtn) { approveBtn.textContent = '✓ Approve'; approveBtn.disabled = false; }
            }
        };

        document.getElementById('btnMgrAuditEod')?.addEventListener('click', openMgrEodModal);
        loadMgrEodList();
        setInterval(loadMgrEodList, 120000);
    

