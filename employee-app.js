import { auth, db } from "./firebase-config.js";
import { collection, getDocs, doc, query, where, updateDoc, addDoc, getDoc, orderBy } from "https://www.gstatic.com/firebasejs/12.12.1/firebase-firestore.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/12.12.1/firebase-auth.js";
import { sendNotification } from "./notification-app.js";

const API_BASE = 'http://127.0.0.1:3000/api';

// ===== MOCK DATA FALLBACKS =====
let mockTasks = [
    { id: 't1', title: 'Update Sales Forecast', description: 'Review Q2 pipeline', assignedByName: 'Alex Manager', deadline: 'Today', status: 'Pending' },
    { id: 't2', title: 'Client Follow-up', description: 'Call Robert Fox', assignedByName: 'Alex Manager', deadline: 'Tomorrow', status: 'In Progress' }
];

let mockLeaves = [
    { type: 'Vacation', startDate: '2026-06-01', endDate: '2026-06-10', status: 'approved' },
    { type: 'Sick Leave', startDate: '2026-05-01', endDate: '2026-05-02', status: 'pending' }
];

// ===== USER INITIALIZATION =====
document.addEventListener('DOMContentLoaded', () => {
    onAuthStateChanged(auth, async (user) => {
        let userData = {
            name: localStorage.getItem('userName') || 'Employee',
            role: localStorage.getItem('userRole') || 'Employee',
            departmentId: localStorage.getItem('userDept') || 'General'
        };

        if (user) {
            try {
                const userDoc = await getDoc(doc(db, 'users', user.uid));
                if (userDoc.exists()) {
                    userData = { ...userData, ...userDoc.data() };
                    localStorage.setItem('userName', userData.name);
                    localStorage.setItem('userRole', userData.role);
                    localStorage.setItem('userDept', userData.departmentId);
                }
            } catch (err) {
                console.warn('Firestore fetch failed, using local session data.');
            }
        }

        // Update UI elements
        const welcomeName = document.querySelector('.page-header h1');
        if (welcomeName) welcomeName.innerHTML = `Welcome back, ${userData.name.split(' ')[0]} 👋`;
        
        const userAvatars = document.querySelectorAll('.user-avatar, .topbar-avatar');
        userAvatars.forEach(a => {
            a.textContent = userData.name.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2);
        });

        const userNameEls = document.querySelectorAll('.user-name');
        userNameEls.forEach(el => el.textContent = userData.name);

        const userRoleEls = document.querySelectorAll('.user-role');
        userRoleEls.forEach(el => {
            const roleStr = userData.role.charAt(0).toUpperCase() + userData.role.slice(1);
            el.textContent = roleStr;
        });

        // Load data based on department
        const userId = user ? user.uid : localStorage.getItem('hr_user_id');
        loadDashboardStats();
        loadEmployeeTasks(userId);
        loadMyLeaveRequests(userId);
        
        const dept = (userData.departmentId || '').toLowerCase();
        if (dept === 'marketing') {
            loadDepartmentData('campaigns', 'employeeCampaignList');
            loadDepartmentData('leads', 'employeeLeadList');
        } else if (dept === 'sales') {
            loadDepartmentData('pipeline', 'employeePipelineList');
            loadDepartmentData('leads', 'employeeLeadList');
        } else if (dept === 'operational' || dept === 'operations') {
            loadDepartmentData('processes', 'employeeProcessList');
            loadDepartmentData('inventory', 'employeeInventoryList');
        }
    });
});

async function loadDashboardStats() {
    try {
        const response = await fetch(`${API_BASE}/data/stats`);
        const result = await response.json();
        if (result.success) {
            const totalEl = document.getElementById('totalEmployees');
            const presentEl = document.getElementById('presentToday');
            const onLeaveEl = document.getElementById('onLeave');
            
            if (totalEl) totalEl.textContent = result.totalEmployees || '0';
            if (presentEl) presentEl.textContent = result.presentToday || '0';
            if (onLeaveEl) onLeaveEl.textContent = result.onLeave || '0';

            const statValues = document.querySelectorAll('.stat-value');
            if (!totalEl && statValues.length >= 3) {
                statValues[0].textContent = result.totalEmployees || '0';
                statValues[1].textContent = result.presentToday || '0';
                statValues[2].textContent = result.onLeave || '0';
            }
        }
    } catch (err) { console.warn('Stats fetch failed:', err.message); }
    loadAttendanceList();
}

async function loadAttendanceList() {
    const list = document.getElementById('attendanceTableBody');
    if (!list) return;
    try {
        const response = await fetch(`${API_BASE}/data/attendance`);
        const result = await response.json();
        if (result.success && result.data.length > 0) {
            list.innerHTML = result.data.map(a => `
                <tr>
                    <td><b>${a.name || a.employeeName}</b></td>
                    <td>${a.employeeId || '#EMP-XXXX'}</td>
                    <td><span class="status-pill ${a.status === 'Present' ? 'status-present' : 'status-absent'}">${a.status}</span></td>
                    <td>${a.checkIn || '--:--'}</td>
                    <td>${a.location || 'Remote'}</td>
                </tr>
            `).join('');
        }
    } catch (err) { console.warn('Attendance list fetch failed:', err.message); }
}

async function loadDepartmentData(collection, listId) {
    const list = document.getElementById(listId);
    if (!list) return;
    const token = localStorage.getItem('hr_access_token');
    
    try {
        const response = await fetch(`${API_BASE}/data/fetch?collection=${collection}`, {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        const result = await response.json();
        
        if (result.success && result.data.length > 0) {
            renderDepartmentList(collection, result.data, list);
        } else {
            // Fallback to mock if empty
            renderMockData(collection, list);
        }
    } catch (err) {
        console.warn(`API fetch for ${collection} failed:`, err.message);
        renderMockData(collection, list);
    }
}

function renderDepartmentList(type, data, list) {
    if (type === 'campaigns') {
        list.innerHTML = data.map(c => `
            <tr>
                <td><b>${c.name}</b></td>
                <td><span class="act-badge success">${c.status || 'Live'}</span></td>
                <td>₹${c.budget || '0'}</td>
                <td>${c.endDate || 'N/A'}</td>
                <td><button class="update-status-btn">Details</button></td>
            </tr>
        `).join('');
    } else if (type === 'pipeline') {
        list.innerHTML = data.map(p => `
            <tr>
                <td><b>${p.name || p.client}</b></td>
                <td>₹${p.value || '0'}</td>
                <td><span class="act-badge info">${p.stage || 'N/A'}</span></td>
                <td>${p.probability || p.closeDate || 'N/A'}</td>
                <td><button class="update-status-btn">Update</button></td>
            </tr>
        `).join('');
    } else if (type === 'leads') {
        list.innerHTML = data.map(l => `
            <tr>
                <td><b>${l.name}</b></td>
                <td>${l.email}</td>
                <td>
                    <select class="update-status-btn">
                        <option value="New" ${l.status === 'New' ? 'selected' : ''}>New</option>
                        <option value="Contacted" ${l.status === 'Contacted' ? 'selected' : ''}>Contacted</option>
                        <option value="Converted" ${l.status === 'Converted' ? 'selected' : ''}>Converted</option>
                    </select>
                </td>
                <td><button class="update-status-btn">Note</button></td>
            </tr>
        `).join('');
    } else if (type === 'processes') {
        list.innerHTML = data.map(c => `
            <tr>
                <td><b>${c.name}</b></td>
                <td><span class="act-badge success">${c.type || 'N/A'}</span></td>
                <td>${c.efficiency || '0'}%</td>
                <td>${c.nextAudit || 'N/A'}</td>
                <td><button class="update-status-btn">Log</button></td>
            </tr>
        `).join('');
    } else if (type === 'inventory') {
        list.innerHTML = data.map(c => `
            <tr>
                <td><b>${c.name}</b></td>
                <td>${c.sku || 'N/A'}</td>
                <td><span class="act-badge ${c.stock < 10 ? 'warn' : 'success'}">${c.stock < 10 ? 'Low' : 'OK'}</span></td>
                <td><button class="update-status-btn">Update</button></td>
            </tr>
        `).join('');
    }
}

function renderMockData(type, list) {
    let data = [];
    if (type === 'campaigns') data = [{ name: 'Summer Blast 24', status: 'Live', budget: '50,000', endDate: '2026-05-30' }];
    else if (type === 'pipeline') data = [{ name: 'Global Corp', value: '25,000', stage: 'Negotiation', probability: '75%' }];
    else if (type === 'leads') data = [{ name: 'Robert Fox', email: 'robert@foxtech.com', status: 'New' }];
    else if (type === 'processes') data = [{ name: 'Q2 Fulfillment', type: 'Logistics', efficiency: '98.2', nextAudit: 'May 15' }];
    else if (type === 'inventory') data = [{ name: 'Packaging Box', sku: 'PB-LRG', stock: 850 }];
    
    renderDepartmentList(type, data, list);
}

window.updateLeadStatus = async (id, status) => { console.log('Lead status updated'); };
window.addLeadNote = async (id) => { prompt('Enter note:'); };

async function loadEmployeeTasks(userId) {
    const taskList = document.getElementById('employeeTaskList');
    if (!taskList) return;

    let tasks = [];
    const token = localStorage.getItem('hr_access_token');

    try {
        // --- STEP 1: Attempt Backend API Fetch ---
        console.log('Fetching tasks from backend API...');
        const response = await fetch(`${API_BASE}/data/fetch?collection=tasks`, {
            headers: {
                'Authorization': `Bearer ${token}`
            }
        });
        const result = await response.json();
        
        if (result.success) {
            // Filter tasks for the current user
            tasks = result.data.filter(t => t.assignedTo === userId);
            console.log(`✅ Loaded ${tasks.length} tasks from API`);
        }
    } catch (apiErr) {
        console.warn('Backend API task fetch failed, falling back to Firestore/Mock...', apiErr.message);
    }

    // --- STEP 2: Firestore Fallback ---
    if (tasks.length === 0 && userId && !userId.startsWith('demo_')) {
        try {
            const q = query(collection(db, 'tasks'), where('assignedTo', '==', userId));
            const snap = await getDocs(q);
            if (!snap.empty) {
                tasks = snap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
                console.log(`✅ Loaded ${tasks.length} tasks from Firestore`);
            }
        } catch (fsErr) {
            console.error('Firestore fallback failed:', fsErr);
        }
    }

    // --- STEP 3: Mock Data Fallback (if still empty) ---
    if (tasks.length === 0) {
        console.log('No cloud tasks found, using mock data.');
        tasks = [...mockTasks];
    }

    taskList.innerHTML = tasks.map(task => `
        <tr>
            <td>
                <div style="font-weight:600;">${task.title}</div>
                <div style="font-size:0.75rem; color:var(--text-muted);">${task.description || ''}</div>
            </td>
            <td>${task.assignedByName || 'Manager'}</td>
            <td>${task.deadline || 'No Deadline'}</td>
            <td><span class="status-pill ${getStatusClass(task.status)}">${task.status}</span></td>
            <td>
                <select onchange="updateTaskStatus('${task.id}', this.value)" style="padding: 0.4rem; border-radius: 8px; border: 1px solid var(--border-color); font-size: 0.8rem; background: #fff;">
                    <option value="Pending" ${task.status === 'Pending' ? 'selected' : ''}>Pending</option>
                    <option value="In Progress" ${task.status === 'In Progress' ? 'selected' : ''}>In Progress</option>
                    <option value="Completed" ${task.status === 'Completed' ? 'selected' : ''}>Completed</option>
                </select>
            </td>
        </tr>
    `).join('');
    
    if (window.lucide) lucide.createIcons();

    // --- STEP 4: Update Dashboard Widget (if present) ---
    const dashboardTaskList = document.getElementById('dashboardTaskList');
    if (dashboardTaskList) {
        dashboardTaskList.innerHTML = tasks.slice(0, 3).map(task => `
            <div class="task-item">
                <div class="task-check ${task.status === 'Completed' ? 'done' : ''}">
                    <i data-lucide="check" size="14" stroke-width="3"></i>
                </div>
                <div class="task-body">
                    <div class="task-title" style="${task.status === 'Completed' ? 'text-decoration: line-through; color: var(--text-muted);' : ''}">${task.title}</div>
                    <div class="task-meta">
                        <span><i data-lucide="clock" size="14" stroke-width="2.5"></i> ${task.deadline || 'Soon'}</span>
                        ${task.status !== 'Completed' ? '<span style="color: var(--red);">Action Required</span>' : '<span>Completed</span>'}
                    </div>
                </div>
            </div>
        `).join('');
        if (window.lucide) lucide.createIcons();
    }
}

window.updateTaskStatus = async (taskId, newStatus) => {
    if (taskId.startsWith('t')) {
        const task = mockTasks.find(t => t.id === taskId);
        if (task) task.status = newStatus;
        if (window.showToast) window.showToast('Demo Updated', 'Task status updated (Demo Mode)', 'info');
        return;
    }
    try {
        await updateDoc(doc(db, 'tasks', taskId), { status: newStatus });
        if (window.showToast) window.showToast('Success', 'Task status updated on cloud.', 'success');
    } catch (err) {
        console.error('Update failed:', err);
    }
};

function getStatusClass(status) {
    switch (status) {
        case 'Completed': return 'status-present';
        case 'In Progress': return 'status-late';
        default: return 'status-absent';
    }
}


window.loadEmployeeTasks = loadEmployeeTasks;

window.openApplyLeaveModal = () => {
    const modal = document.getElementById('leaveModal');
    if (modal) modal.style.display = 'flex';
};

window.closeLeaveModal = () => {
    const modal = document.getElementById('leaveModal');
    if (modal) modal.style.display = 'none';
};

const btnSubmitLeave = document.getElementById('btnSubmitLeave');
if (btnSubmitLeave) {
    btnSubmitLeave.addEventListener('click', async () => {
        const reason = document.getElementById('leaveReason').value.trim();
        const start = document.getElementById('leaveStart').value;
        const end = document.getElementById('leaveEnd').value;
        const type = document.getElementById('leaveType').value;
        
        const userId = auth.currentUser ? auth.currentUser.uid : localStorage.getItem('hr_user_id');
        const userName = localStorage.getItem('userName') || 'Employee';
        const userDept = localStorage.getItem('userDept') || 'General';

        if (!reason || !start || !end) {
            alert('Please fill in all required fields.');
            return;
        }

        try {
            btnSubmitLeave.disabled = true;
            btnSubmitLeave.textContent = 'Submitting...';

            const token = localStorage.getItem('hr_access_token');
            const response = await fetch(`${API_BASE}/data/add`, {
                method: 'POST',
                headers: { 
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`
                },
                body: JSON.stringify({
                    collection: 'leave_requests',
                    data: {
                        userId,
                        userName,
                        departmentId: userDept,
                        type,
                        startDate: start,
                        endDate: end,
                        reason,
                        status: 'pending'
                    }
                })
            });

            const result = await response.json();

            if (result.success) {
                closeLeaveModal();
                const successModal = document.getElementById('successModal');
                if (successModal) {
                    const msgEl = document.getElementById('successModalMsg');
                    if (msgEl) msgEl.textContent = `Leave request submitted successfully to Manager!`;
                    successModal.style.display = 'flex';
                    if (window.lucide) lucide.createIcons();
                }
                loadMyLeaveRequests(userId);
            } else {
                throw new Error(result.message);
            }
            
        } catch (err) {
            console.error('Error submitting leave:', err);
            alert('Submission failed: ' + err.message);
        } finally {
            btnSubmitLeave.disabled = false;
            btnSubmitLeave.textContent = 'Submit Request';
        }
    });
}

async function loadMyLeaveRequests(userId) {
    const list = document.getElementById('myLeaveList');
    if (!list) return;

    let leaves = [];
    const token = localStorage.getItem('hr_access_token');

    try {
        // --- STEP 1: Attempt Backend API Fetch ---
        const response = await fetch(`${API_BASE}/data/fetch?collection=leave_requests`, {
            headers: {
                'Authorization': `Bearer ${token}`
            }
        });
        const result = await response.json();
        
        if (result.success) {
            leaves = result.data.filter(l => l.userId === userId || l.uid === userId);
            console.log(`✅ Loaded ${leaves.length} leave requests from API`);
        }
    } catch (apiErr) {
        console.warn('Backend API leave fetch failed, falling back to Firestore...', apiErr.message);
        
        // --- STEP 2: Firestore Fallback ---
        if (userId && !userId.startsWith('demo_')) {
            try {
                const q = query(collection(db, 'leave_requests'), where('userId', '==', userId));
                const snap = await getDocs(q);
                if (!snap.empty) {
                    leaves = snap.docs.map(doc => doc.data());
                }
            } catch (fsErr) {
                console.error('Firestore fallback failed:', fsErr);
            }
        }
    }

    // --- STEP 3: Mock Data Fallback ---
    if (leaves.length === 0) {
        leaves = [...mockLeaves];
    }

    list.innerHTML = leaves.map(leaf => `
        <div style="padding:1rem; border-radius:12px; border:1px solid var(--border-color); background:#fff;">
            <div style="display:flex; justify-content:space-between; align-items:center;">
                <div>
                    <div style="font-weight:600; font-size:0.9rem;">${leaf.type}</div>
                    <div style="font-size:0.75rem; color:var(--text-muted);">${leaf.startDate} to ${leaf.endDate}</div>
                </div>
                <span class="status-pill ${leaf.status === 'approved' ? 'status-present' : (leaf.status === 'rejected' ? 'status-absent' : 'status-late')}">
                    ${leaf.status.charAt(0).toUpperCase() + leaf.status.slice(1)}
                </span>
            </div>
        </div>
    `).join('');
}
window.loadMyLeaveRequests = loadMyLeaveRequests;
window.loadMyPipeline = () => loadDepartmentData('pipeline', 'employeePipelineList');
window.loadMyProcesses = () => loadDepartmentData('processes', 'employeeProcessList');
window.loadMyInventory = () => loadDepartmentData('inventory', 'employeeInventoryList');

