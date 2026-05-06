import { auth, db } from "./firebase-config.js";
import { signOut, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/12.12.1/firebase-auth.js";
import { collection, getDocs, addDoc, query, orderBy, limit, doc, getDoc, setDoc, where, updateDoc, deleteDoc } from "https://www.gstatic.com/firebasejs/12.12.1/firebase-firestore.js";
import { sendNotification } from "./notification-app.js";

const API_BASE = 'http://localhost:3000/api';

let attendanceData = [];
let activities = [];

// ===== NAVIGATION =====
const navItems = document.querySelectorAll('.nav-item[data-page]');
const pages = document.querySelectorAll('.page');
const pageTitle = document.getElementById('pageTitle');
const sidebar = document.getElementById('sidebar');
const menuToggle = document.getElementById('menuToggle');

const pageTitles = {
  'dashboard': 'Engineering Hub',
  'tasks': 'Issue Tracker',
  'reports': 'System Health',
  'messages': 'Team Messages',
  'notifications': 'System Notifications',
  'ai-messaging': 'Code Review AI',
  'bank': 'Infra Budget',
  'integration': 'DevOps Tools',
  'settings': 'Settings'
};

const globalLoader = document.getElementById('globalLoader');

function navigateTo(pageId) {
  // Activate loader
  if (globalLoader) {
    globalLoader.classList.add('active');
    setTimeout(() => globalLoader.classList.remove('active'), 800);
  }

  pages.forEach(p => p.classList.remove('active'));
  navItems.forEach(n => n.classList.remove('active'));
  const target = document.getElementById('page-' + pageId);
  if (target) target.classList.add('active');
  const navEl = document.getElementById('nav-' + pageId);
  if (navEl) navEl.classList.add('active');
  pageTitle.textContent = pageTitles[pageId] || pageId;
  sidebar.classList.remove('open');
}

// ===== AUTH: LOGOUT =====
const btnLogout = document.getElementById('btnLogout');
const btnHeaderLogout = document.getElementById('btnHeaderLogout');

const handleLogout = async () => {
  try {
    await signOut(auth);
    localStorage.removeItem('hr_logged_in');
    window.location.href = 'login.html';
  } catch (error) {
    console.error('Logout error:', error);
  }
};

if (btnLogout) btnLogout.addEventListener('click', handleLogout);
if (btnHeaderLogout) btnHeaderLogout.addEventListener('click', handleLogout);

// Auth Observer: Double check session
onAuthStateChanged(auth, async (user) => {
  if (user) {
    let data;
    try {
      const userDoc = await getDoc(doc(db, 'users', user.uid));
      if (userDoc.exists()) {
        data = userDoc.data();
      }
    } catch (err) {
      console.warn('Engineering fetch failed, using fallback.');
    }

    if (!data) {
      data = {
        name: localStorage.getItem('userName') || user.displayName || user.email.split('@')[0],
        role: localStorage.getItem('userRole') || 'Engineering Manager',
        departmentId: localStorage.getItem('userDept') || 'engineering'
      };
    }

    localStorage.setItem('userName', data.name);
    localStorage.setItem('userRole', data.role);
    localStorage.setItem('userDept', data.departmentId);
    
    // Update UI
    const welcomeText = document.querySelector('.page-header h1');
    if (welcomeText) welcomeText.innerHTML = `Good Day, ${data.name.split(' ')[0]} 👋`;
    
    const sidebarNames = document.querySelectorAll('.user-name');
    sidebarNames.forEach(n => n.textContent = data.name);
    
    const sidebarRoles = document.querySelectorAll('.user-role');
    sidebarRoles.forEach(r => {
      const roleStr = data.role.charAt(0).toUpperCase() + data.role.slice(1);
      r.textContent = roleStr.includes('Manager') ? roleStr : `${roleStr} Manager`;
    });

    const avatars = document.querySelectorAll('.user-avatar, .topbar-avatar');
    avatars.forEach(a => a.textContent = data.name.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2));
    
    loadDashboardData();
  } else if (localStorage.getItem('hr_logged_in') === 'true') {
    console.log('✅ Authenticated via Local Session (API/Demo)');
    loadDashboardData();
  } else {
    const currentFile = window.location.pathname.split('/').pop();
    if (currentFile && currentFile !== 'index.html' && currentFile !== 'manager-login.html') {
        window.location.href = 'index.html';
    }
  }
});

navItems.forEach(item => {
  item.addEventListener('click', e => {
    e.preventDefault();
    navigateTo(item.dataset.page);
  });
});

menuToggle.addEventListener('click', () => sidebar.classList.toggle('open'));
document.addEventListener('click', e => {
  if (!sidebar.contains(e.target) && !menuToggle.contains(e.target)) {
    sidebar.classList.remove('open');
  }
});

// ===== SET TODAY'S DATE =====
const dateInput = document.getElementById('attendDate');
if (dateInput) dateInput.value = new Date().toISOString().split('T')[0];

let sprintChartInstance = null;
let qualityChartInstance = null;

function updateCharts() {
  const sprCtx = document.getElementById('sprintChart');
  const qualCtx = document.getElementById('qualityChart');

  if (!sprCtx || !qualCtx) return;

  if (sprintChartInstance) sprintChartInstance.destroy();
  if (qualityChartInstance) qualityChartInstance.destroy();

  sprintChartInstance = new Chart(sprCtx, {
    type: 'line',
    data: {
      labels: ['Day 1', 'Day 3', 'Day 5', 'Day 7', 'Today'],
      datasets: [
        { 
          label: 'Ideal Burn', 
          data: [100, 75, 50, 25, 0], 
          borderColor: '#e2e8f0', 
          borderDash: [5, 5],
          fill: false
        },
        { 
          label: 'Actual Burn', 
          data: [100, 82, 60, 40, 18], 
          borderColor: '#0ea5e9', 
          backgroundColor: 'rgba(14,165,233,0.1)', 
          fill: true,
          tension: 0.4
        }
      ]
    },
    options: { responsive: true, plugins: { legend: { position: 'top' } }, scales: { x: { grid: { display: false } }, y: { grid: { color: '#f1f5f9' } } } }
  });

  qualityChartInstance = new Chart(qualCtx, {
    type: 'radar',
    data: {
      labels: ['Security', 'Speed', 'Stability', 'Coverage', 'UI/UX'],
      datasets: [{ 
        label: 'Current Build',
        data: [85, 92, 78, 95, 88], 
        backgroundColor: 'rgba(14,165,233,0.2)', 
        borderColor: '#0ea5e9',
        borderWidth: 2
      }]
    },
    options: { responsive: true, plugins: { legend: { display: false } } }
  });
}

async function loadBankDetails() {
  try {
    const q = query(collection(db, 'bank_details'), orderBy('updatedAt', 'desc'), limit(1));
    const snap = await getDocs(q);
    if (!snap.empty) {
      const data = snap.docs[0].data();
      if (document.getElementById('uiBankAcc')) document.getElementById('uiBankAcc').textContent = data.account || '**** 4242';
      if (document.getElementById('uiBankName')) document.getElementById('uiBankName').textContent = data.name || 'HDFC Bank';
      if (document.getElementById('uiBankRouting')) document.getElementById('uiBankRouting').textContent = 'Routing: ' + (data.routing || '021000021');
      if (document.getElementById('uiBankBalance')) document.getElementById('uiBankBalance').textContent = '₹' + (data.balance || '245,800.00');
    }
  } catch (e) {
    console.error('Bank load error:', e);
  }
}

async function loadDisbursements() {
  const list = document.getElementById('disbursementList');
  if (!list) return;
  try {
    const q = query(collection(db, 'payroll'), orderBy('processedAt', 'desc'), limit(5));
    const snap = await getDocs(q);
    if (!snap.empty) {
      list.innerHTML = snap.docs.map(doc => {
        const p = doc.data();
        const initial = p.employeeName?.[0] || 'P';
        return `
          <div class="disbursement-item">
            <div class="act-avatar blue">${initial}</div>
            <div class="act-body"><b>${p.name || 'Payroll'}</b> ${p.month || 'Current Batch'}<span class="act-time">${new Date(p.processedAt).toLocaleDateString()}</span></div>
            <span class="act-badge success">₹${p.net || '0'}</span>
          </div>
        `;
      }).join('');
    }
  } catch (e) {
    console.error('Disbursement load error:', e);
  }
}

async function loadDashboardData() {
  try {
    const userRole = localStorage.getItem('userRole');
    const userDept = localStorage.getItem('userDept') || 'engineering';
    let employees = [];

    // 1. Fetch Department Employees from Backend
    try {
      const token = auth.currentUser ? await auth.currentUser.getIdToken() : localStorage.getItem('hr_access_token');
      const response = await fetch(`${API_BASE}/admin/employees`, {
        headers: { ...(token ? { 'Authorization': `Bearer ${token}` } : {}) }
      });
      
      if (response.ok) {
        const result = await response.json();
        employees = result.data.filter(e => e.departmentId === userDept || e.dept === userDept);
      } else {
        throw new Error('Backend fetch failed');
      }
    } catch (err) {
      console.warn('Backend sync failed, using Firestore fallback');
      if (auth.currentUser) {
        try {
          const empQuery = query(collection(db, 'users'), where('departmentId', '==', userDept));
          const empSnap = await getDocs(empQuery);
          employees = empSnap.docs.map(doc => ({ id: doc.id, ...doc.data() })).filter(u => u.role === 'employee');
        } catch (fsErr) {
          console.warn('Firestore fallback restricted:', fsErr.message);
        }
      }
    }

    document.getElementById('stat-active-projects').textContent = '9';
    document.getElementById('stat-tasks').textContent = '156';
    document.getElementById('stat-bugs').textContent = '14';
    document.getElementById('stat-sprint-prog').textContent = '84%';
    
    renderTeamList(employees);
    loadTasks();
    populateAssigneeDropdown(employees);

    updateCharts();
    loadActivities();
    loadBankDetails();
    loadSettings();
  } catch (error) {
    console.error('Data load error:', error);
  }
}

// --- Task Management ---
const createTaskModal = document.getElementById('createTaskModal');
const managerTaskList = document.getElementById('managerTaskList');
const taskAssigneeDropdown = document.getElementById('taskAssignee');

window.openCreateTaskModal = () => {
    if (createTaskModal) createTaskModal.style.display = 'flex';
};

window.closeCreateTaskModal = () => {
    if (createTaskModal) createTaskModal.style.display = 'none';
};

function populateAssigneeDropdown(employees) {
    if (!taskAssigneeDropdown) return;
    taskAssigneeDropdown.innerHTML = employees.map(emp => `<option value="${emp.id}">${emp.name}</option>`).join('');
}

async function loadTasks() {
    if (!managerTaskList) return;
    const userId = auth.currentUser ? auth.currentUser.uid : localStorage.getItem('hr_user_id');
    
    if (!auth.currentUser) {
        console.log('Skipping tasks fetch (No active Firebase session)');
        managerTaskList.innerHTML = '<tr><td colspan="5" style="text-align:center; padding:2rem; color:var(--text-muted);">Tasks unavailable (Local Mode)</td></tr>';
        return;
    }

    try {
        const q = query(collection(db, 'tasks'), where('assignedBy', '==', userId));
        const snap = await getDocs(q);
        const tasks = snap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        
        managerTaskList.innerHTML = tasks.map(task => `
            <tr>
                <td>
                    <div style="font-weight:600;">${task.title}</div>
                    <div style="font-size:0.75rem; color:var(--text-muted);">${task.description || ''}</div>
                </td>
                <td>${task.assigneeName || 'Unassigned'}</td>
                <td>${task.deadline || 'No Deadline'}</td>
                <td><span class="status-pill ${getStatusClass(task.status)}">${task.status}</span></td>
                <td>
                    <button class="action-btn" onclick="deleteTask('${task.id}')" title="Delete Task"><i data-lucide="trash-2" size="14"></i></button>
                </td>
            </tr>
        `).join('');
        if (window.lucide) { lucide.createIcons(); }
    } catch (err) {
        console.error('Error loading tasks:', err);
    }
}

function getStatusClass(status) {
    switch (status) {
        case 'Completed': return 'status-present';
        case 'In Progress': return 'status-late';
        default: return 'status-absent';
    }
}

const btnSaveTask = document.getElementById('btnSaveTask');
if (btnSaveTask) {
    btnSaveTask.addEventListener('click', async () => {
        const title = document.getElementById('taskTitle').value.trim();
        const assigneeId = document.getElementById('taskAssignee').value;
        const assigneeName = document.getElementById('taskAssignee').options[document.getElementById('taskAssignee').selectedIndex].text;
        const deadline = document.getElementById('taskDeadline').value;
        const description = document.getElementById('taskDescription').value.trim();
        const managerId = auth.currentUser ? auth.currentUser.uid : localStorage.getItem('hr_user_id');
        const managerName = localStorage.getItem('userName') || 'Manager';

        if (!title || !assigneeId) {
            alert('Please fill in required fields.');
            return;
        }

        try {
            btnSaveTask.disabled = true;
            btnSaveTask.textContent = 'Saving...';

            await addDoc(collection(db, 'tasks'), {
                title,
                description,
                assignedTo: assigneeId,
                assigneeName,
                assignedBy: managerId,
                assignedByName: managerName,
                deadline,
                status: 'Pending',
                createdAt: new Date().toISOString()
            });

            // Trigger Notification
            await sendNotification(assigneeId, 'New Task Assigned', `Task: ${title}`, 'task');

            closeCreateTaskModal();
            loadTasks();
            // Reset form
            document.getElementById('taskTitle').value = '';
            document.getElementById('taskDeadline').value = '';
            document.getElementById('taskDescription').value = '';
        } catch (err) {
            console.error('Error saving task:', err);
        } finally {
            btnSaveTask.disabled = false;
            btnSaveTask.textContent = 'Create Task';
        }
    });
}

window.deleteTask = async (id) => {
    if (!confirm('Are you sure you want to delete this task?')) return;
    try {
        await deleteDoc(doc(db, 'tasks', id));
        loadTasks();
        if (window.showToast) window.showToast('Task Deleted', 'The task has been permanently removed.', 'success');
    } catch (err) {
        console.error('Delete error:', err);
    }
};

function renderTeamList(employees) {
  const teamList = document.getElementById('teamList');
  if (!teamList) return;

  if (employees.length === 0) {
    teamList.innerHTML = '<div style="text-align:center; padding:2rem; color:var(--text-2); font-size:.9rem;">No team members assigned yet.</div>';
    return;
  }

  teamList.innerHTML = employees.map(emp => `
    <div class="activity-item">
      <div class="act-avatar" style="background: var(--primary); color: white;">${emp.name.charAt(0)}</div>
      <div class="act-body">
        <div class="act-text"><b>${emp.name}</b></div>
        <div class="act-time">${emp.role || emp.dept || 'Engineer'}</div>
      </div>
      <span class="act-badge success" style="font-size: 0.7rem;">Active</span>
    </div>
  `).join('');
}

async function loadActivities() {
  const activityList = document.querySelector('.recent-activity .activity-list');
  if (!activityList) return;

  activityList.innerHTML = '';

  try {
    const actSnap = await getDocs(collection(db, 'activities'));
    activities = actSnap.docs.map(doc => doc.data());

    if (activities.length > 0) {
      activityList.innerHTML = activities.map(act => `
        <div class="activity-item">
          <div class="act-avatar ${act.color || 'blue'}">${act.initials || '??'}</div>
          <div class="act-body">
            <div class="act-text"><b>${act.user}</b> ${act.action}</div>
            <div class="act-time">${act.time}</div>
          </div>
        </div>
      `).join('');
    } else {
      activityList.innerHTML = '<div style="text-align:center; padding:2rem; color:var(--text-2); font-size:.9rem;">No recent activity to show.</div>';
    }
  } catch (error) {
    console.warn('Could not load live activities.');
    activityList.innerHTML = '<div style="text-align:center; padding:2rem; color:var(--danger); font-size:.9rem;">Unable to connect to activity feed.</div>';
  }
}

function useDemoData() {
  attendanceData = [];
}


// Initialize data load
// Initialization is now handled by onAuthStateChanged listener to ensure auth.currentUser is ready
// loadDashboardData();

const statusMap = { present: 'pill-present', absent: 'pill-absent', late: 'pill-late', leave: 'pill-leave' };
const statusLabel = { present: 'Present', absent: 'Absent', late: 'Late', leave: 'On Leave' };


function renderAttendance(filter = 'all', search = '') {
  const tbody = document.getElementById('attendanceBody');
  if (!tbody) return;
  
  let filtered = filter === 'all' ? attendanceData : attendanceData.filter(e => e.status === filter);
  
  if (search) {
    const s = search.toLowerCase();
    filtered = filtered.filter(e => e.name.toLowerCase().includes(s) || e.id.toLowerCase().includes(s));
  }

  tbody.innerHTML = filtered.map(e => {
    const isLate = e.status === 'late';
    return `
      <tr>
        <td><code style="font-weight:600; color:var(--text-2);">${e.id}</code></td>
        <td><div class="emp-cell"><div class="emp-avatar" style="background:${e.color}">${e.initials}</div>${e.name}</div></td>
        <td style="${isLate ? 'color:var(--red); font-weight:700;' : ''}">${e.loginTime}</td>
        <td><span class="status-pill ${statusMap[e.status]}">${statusLabel[e.status]}</span></td>
        <td><button class="action-btn" style="padding:.3rem .75rem;font-size:.78rem;"><i class="fa-solid fa-ellipsis"></i></button></td>
      </tr>`;
  }).join('');
  
  // Update summary counts
  const pCount = document.getElementById('stat-present-today');
  if (pCount) pCount.textContent = attendanceData.filter(e => e.status === 'present').length;
  
  const aCount = document.getElementById('stat-total-employees');
  if (aCount) aCount.textContent = attendanceData.length;
  
  const lvCount = document.getElementById('stat-on-leave');
  if (lvCount) lvCount.textContent = attendanceData.filter(e => e.status === 'leave').length;
  
  // Footer summary counts (old IDs preserved for compatibility if they exist)
  const fpCount = document.getElementById('presentCount');
  if (fpCount) fpCount.textContent = attendanceData.filter(e => e.status === 'present').length;
  const faCount = document.getElementById('absentCount');
  if (faCount) faCount.textContent = attendanceData.filter(e => e.status === 'absent').length;
  const flCount = document.getElementById('lateCount');
  if (flCount) flCount.textContent = attendanceData.filter(e => e.status === 'late').length;
  const flvCount = document.getElementById('leaveCount');
  if (flvCount) flvCount.textContent = attendanceData.filter(e => e.status === 'leave').length;

  // Update dynamic charts
  if (typeof updateCharts === 'function') updateCharts();
}


renderAttendance();

// Search listener
const attendSearch = document.getElementById('attendanceSearch');
if (attendSearch) {
  attendSearch.addEventListener('input', (e) => {
    const activeFilter = document.querySelector('.ftab.active')?.dataset.filter || 'all';
    renderAttendance(activeFilter, e.target.value);
  });
}

document.querySelectorAll('.ftab').forEach(tab => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.ftab').forEach(t => t.classList.remove('active'));
    tab.classList.add('active');
    const searchQuery = document.getElementById('attendanceSearch')?.value || '';
    renderAttendance(tab.dataset.filter, searchQuery);
  });
});

// ===== PAYROLL DATA (Initialized from Firestore) =====
let payrollData = [
  { name: 'Alice Johnson', initials: 'AJ', color: '#3b82f6', position: 'Senior Engineer', base: '₹9,500', bonus: '₹800', deductions: '₹1,200', net: '₹9,100', status: 'paid' },
  { name: 'Bob Martinez', initials: 'BM', color: '#8b5cf6', position: 'Marketing Lead', base: '₹7,200', bonus: '₹400', deductions: '₹950', net: '₹6,650', status: 'paid' },
  { name: 'Carol White', initials: 'CW', color: '#10b981', position: 'UI/UX Designer', base: '₹6,800', bonus: '₹300', deductions: '₹880', net: '₹6,220', status: 'pending' },
  { name: 'David Lee', initials: 'DL', color: '#f59e0b', position: 'HR Specialist', base: '₹5,500', bonus: '₹200', deductions: '₹720', net: '₹4,980', status: 'paid' },
  { name: 'Emma Davis', initials: 'ED', color: '#ef4444', position: 'Finance Analyst', base: '₹6,200', bonus: '₹350', deductions: '₹800', net: '₹5,750', status: 'pending' },
  { name: 'Frank Chen', initials: 'FC', color: '#6366f1', position: 'Backend Engineer', base: '₹8,800', bonus: '₹600', deductions: '₹1,100', net: '₹8,300', status: 'paid' },
];

function renderPayroll() {
  const tbody = document.getElementById('payrollBody');
  if (!tbody) return;
  tbody.innerHTML = payrollData.map(e => `
    <tr>
      <td><div class="emp-cell"><div class="emp-avatar" style="background:${e.color}">${e.initials}</div>${e.name}</div></td>
      <td>${e.base}</td>
      <td style="color:var(--red)">${e.deductions}</td>
      <td style="font-weight:700">${e.net}</td>
      <td><span class="status-pill ${e.status === 'paid' ? 'pill-present' : 'pill-pending'}">${e.status === 'paid' ? 'Paid' : 'Pending'}</span></td>
      <td>
        ${e.status === 'pending' 
          ? `<button class="btn-primary" style="padding:.3rem .75rem; font-size:.75rem; background:var(--green);">Approve</button>` 
          : `<button class="action-btn" style="padding:.3rem .75rem; font-size:.75rem;"><i class="fa-solid fa-check"></i> View</button>`}
      </td>
    </tr>`).join('');
}
renderPayroll();

// ===== REPORTS LIST =====
const reports = [
  { icon: 'fa-users', iconBg: '#dbeafe', iconColor: '#2563eb', name: 'Employee Headcount Report', meta: 'Updated Apr 30, 2026 · PDF' },
  { icon: 'fa-calendar-check', iconBg: '#d1fae5', iconColor: '#10b981', name: 'Monthly Attendance Summary', meta: 'Updated Apr 30, 2026 · Excel' },
  { icon: 'fa-money-bill-wave', iconBg: '#fef3c7', iconColor: '#f59e0b', name: 'Payroll Disbursement Report', meta: 'Updated Apr 28, 2026 · PDF' },
  { icon: 'fa-chart-line', iconBg: '#ede9fe', iconColor: '#8b5cf6', name: 'Performance Analytics Q1', meta: 'Updated Apr 25, 2026 · PDF' },
  { icon: 'fa-door-open', iconBg: '#fee2e2', iconColor: '#ef4444', name: 'Employee Turnover Report', meta: 'Updated Apr 20, 2026 · PDF' },
];

function renderReports() {
  const list = document.getElementById('reportList');
  if (!list) return;
  list.innerHTML = reports.map(r => `
    <div class="report-item">
      <div class="report-icon" style="background:${r.iconBg};color:${r.iconColor}"><i class="fa-solid ${r.icon}"></i></div>
      <div class="report-name">${r.name}<div class="report-meta">${r.meta}</div></div>
      <button class="report-dl"><i class="fa-solid fa-download"></i> Download</button>
    </div>`).join('');
}
renderReports();

// ===== WEEKLY ABSENCE DATA (Live) =====
let absenceData = [
  { name: 'Emma Davis', initials: 'ED', color: '#ef4444', dept: 'Finance', reason: 'Medical Leave', dates: 'Apr 27 - May 01', status: 'approved' },
  { name: 'Carol White', initials: 'CW', color: '#10b981', dept: 'Design', reason: 'Personal', dates: 'Apr 29 - Apr 30', status: 'approved' },
  { name: 'Michael Scott', initials: 'MS', color: '#3b82f6', dept: 'Sales', reason: 'Vacation', dates: 'Apr 30 - May 10', status: 'pending' },
  { name: 'Pam Beesly', initials: 'PB', color: '#ec4899', dept: 'HR', reason: 'Sick Leave', dates: 'Apr 30 - Apr 30', status: 'approved' },
  { name: 'Jim Halpert', initials: 'JH', color: '#6366f1', dept: 'Engineering', reason: 'Paternity', dates: 'May 01 - May 14', status: 'pending' },
];

async function loadLeaveRequests() {
  const tbody = document.getElementById('absenceTableBody');
  if (!tbody) return;
  try {
    const snap = await getDocs(collection(db, 'leave_requests'));
    const requests = snap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    tbody.innerHTML = requests.map(req => `
      <tr>
        <td><div class="emp-cell"><div class="emp-avatar" style="background:var(--primary);">${req.userName ? req.userName.charAt(0) : '?'}</div>${req.userName || 'Unknown'}</div></td>
        <td>${req.userDept || 'N/A'}</td>
        <td>${req.reason || 'N/A'}</td>
        <td>${req.startDate} to ${req.endDate}</td>
        <td><span class="status-pill ${req.status === 'approved' ? 'pill-present' : (req.status === 'rejected' ? 'pill-absent' : 'pill-pending')}">${req.status.charAt(0).toUpperCase() + req.status.slice(1)}</span></td>
        <td>
          ${req.status === 'pending' ? `
            <div style="display:flex; gap:0.5rem;">
              <button class="btn-approve" onclick="handleLeaveAction('${req.id}', 'approved')" style="padding:0.25rem 0.5rem; background:var(--success); color:white; border:none; border-radius:4px; cursor:pointer;"><i class="fa-solid fa-check"></i></button>
              <button class="btn-reject" onclick="handleLeaveAction('${req.id}', 'rejected')" style="padding:0.25rem 0.5rem; background:var(--red); color:white; border:none; border-radius:4px; cursor:pointer;"><i class="fa-solid fa-times"></i></button>
            </div>
          ` : '--'}
        </td>
      </tr>`).join('');
  } catch (err) { console.error('Error loading leave requests:', err); }
}

window.handleLeaveAction = async (requestId, action) => {
  try {
    const reqRef = doc(db, 'leave_requests', requestId);
    await updateDoc(reqRef, { status: action });
    const reqSnap = await getDoc(reqRef);
    if (reqSnap.exists()) {
      const data = reqSnap.data();
      await sendNotification(data.userId, `Leave ${action.charAt(0).toUpperCase() + action.slice(1)}`, `Your leave request for ${data.startDate} has been ${action}.`, 'leave');
    }
    loadLeaveRequests();
    if (window.showToast) window.showToast('Leave Updated', `Request has been ${action}. Notification sent.`, action === 'approved' ? 'success' : 'warning');
  } catch (err) { console.error('Error updating leave status:', err); }
};
loadLeaveRequests();

// ===== EXPORT & DOWNLOAD HANDLERS =====
const btnExport = document.getElementById('exportReport');
if (btnExport) {
  btnExport.addEventListener('click', () => {
    const originalText = btnExport.innerHTML;
    btnExport.disabled = true;
    btnExport.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Exporting...';
    
    setTimeout(() => {
      // Trigger actual dummy download
      const blob = new Blob([`HRFlow Export Data for ${document.getElementById('reportWeek').value}`], { type: 'text/plain' });
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `HRFlow_Export_${document.getElementById('reportWeek').value}.txt`;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);

      showToast('Export Successful', `Report has been downloaded.`, 'success');
      btnExport.disabled = false;
      btnExport.innerHTML = originalText;
    }, 1500);

  });
}

// Delegate download button clicks
document.addEventListener('click', (e) => {
  const dlBtn = e.target.closest('.report-dl');
  if (!dlBtn) return;
  
  const reportName = dlBtn.closest('.report-item').querySelector('.report-name').firstChild.textContent;
  const originalText = dlBtn.innerHTML;
  
  dlBtn.disabled = true;
  dlBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i>';
  
  setTimeout(() => {
    // Trigger actual dummy download
    const blob = new Blob([`Report Data: ${reportName}`], { type: 'text/plain' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${reportName.replace(/\s+/g, '_')}.txt`;
    document.body.appendChild(a);
    a.click();
    window.URL.revokeObjectURL(url);
    document.body.removeChild(a);

    showToast('Download Complete', `${reportName} downloaded successfully.`, 'success');
    dlBtn.disabled = false;
    dlBtn.innerHTML = originalText;
  }, 1000);

});

// ===== PAYROLL RUN HANDLER =====
const btnRunPayrollMain = document.getElementById('btnRunPayrollMain');
if (btnRunPayrollMain) {
  btnRunPayrollMain.addEventListener('click', () => {
    openModal('Processing Payroll', `
      <div style="text-align:center; padding: 1rem 0;">
        <p style="margin-bottom: 1.5rem; color: var(--text-2);">Calculating salaries, taxes, and deductions for April 2026...</p>
        <div style="width: 100%; height: 8px; background: var(--bg); border-radius: 10px; overflow: hidden; margin-bottom: 1rem;">
          <div id="payrollProgress" style="width: 0%; height: 100%; background: var(--primary); transition: width 0.3s ease;"></div>
        </div>
        <p id="payrollStatusText" style="font-size: .85rem; font-weight: 600; color: var(--primary);">Initializing...</p>
      </div>
    `, null); // null confirm because we'll handle it automatically

    // Hide footer buttons for this modal
    document.querySelector('.modal-footer').style.display = 'none';

    const progress = document.getElementById('payrollProgress');
    const statusText = document.getElementById('payrollStatusText');
    const steps = ['Validating attendance...', 'Calculating deductions...', 'Generating payslips...', 'Finalizing payments...'];
    
    let currentStep = 0;
    const interval = setInterval(() => {
      currentStep++;
      const percent = (currentStep / steps.length) * 100;
      if (progress) progress.style.width = percent + '%';
      if (statusText) statusText.textContent = steps[currentStep - 1] || 'Complete!';
      
      if (currentStep >= steps.length) {
        clearInterval(interval);
        setTimeout(async () => {
          closeModal();
          document.querySelector('.modal-footer').style.display = 'flex';
          
          // Update and Persist to Firestore
          try {
            for (const p of payrollData) {
              if (p.status === 'pending') {
                p.status = 'paid';
                p.processedAt = new Date().toISOString();
                await addDoc(collection(db, 'payroll'), p);
              }
            }
            renderPayroll();
            showToast('Payroll Successful', 'All payments have been processed and saved.', 'success');
          } catch (err) {
            console.error('Payroll Sync Error:', err);
            showToast('Sync Error', 'Payroll processed locally but failed to save in Cloud.', 'warning');
          }
        }, 800);
      }
    }, 1000);
  });
}

// Global initialization on load
window.addEventListener('load', () => {
  updateCharts();
  
  // Static Charts (Hiring, Payroll, Satisfaction)
  const hiCtx = document.getElementById('hiringChart');
  if (hiCtx) {
    new Chart(hiCtx, {
      type: 'line',
      data: {
        labels: ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'],
        datasets: [{
          label: 'New Hires', data: [8,12,7,15,10,18,14,9,11,16,13,20],
          borderColor: '#2563eb', backgroundColor: 'rgba(37,99,235,0.08)',
          fill: true, tension: 0.4, pointBackgroundColor: '#2563eb', pointRadius: 4
        }]
      },
      options: { responsive: true, plugins: { legend: { display: false } }, scales: { x: { grid: { display: false } }, y: { grid: { color: '#f1f5f9' } } } }
    });
  }

  const prCtx = document.getElementById('payrollTrendChart');
  if (prCtx) {
    new Chart(prCtx, {
      type: 'bar',
      data: {
        labels: ['Jan','Feb','Mar','Apr','May','Jun'],
        datasets: [{
          label: 'Payroll (₹K)', data: [980,1020,1050,1100,1080,1240],
          backgroundColor: '#10b981', borderRadius: 8
        }]
      },
      options: { responsive: true, plugins: { legend: { display: false } }, scales: { x: { grid: { display: false } }, y: { grid: { color: '#f1f5f9' } } } }
    });
  }

  const satCtx = document.getElementById('satisfactionChart');
  if (satCtx) {
    new Chart(satCtx, {
      type: 'line',
      data: {
        labels: ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'],
        datasets: [
          { label: 'Satisfaction', data: [72,75,70,78,80,82,79,83,85,81,84,88], borderColor: '#8b5cf6', backgroundColor: 'rgba(139,92,246,0.08)', fill: true, tension: 0.4, pointBackgroundColor: '#8b5cf6' },
          { label: 'Engagement', data: [65,68,66,72,75,77,74,79,80,78,82,85], borderColor: '#f59e0b', backgroundColor: 'rgba(245,158,11,0.08)', fill: true, tension: 0.4, pointBackgroundColor: '#f59e0b' }
        ]
      },
    });
  }

  // Report Dept Chart
  const rdCtx = document.getElementById('reportDeptChart');
  if (rdCtx) {
    new Chart(rdCtx, {
      type: 'polarArea',
      data: {
        labels: ['Eng', 'Mkt', 'Des', 'Fin', 'Sales', 'HR'],
        datasets: [{
          data: [12, 5, 8, 3, 15, 4],
          backgroundColor: [
            'rgba(59, 130, 246, 0.7)',
            'rgba(139, 92, 246, 0.7)',
            'rgba(16, 185, 129, 0.7)',
            'rgba(245, 158, 11, 0.7)',
            'rgba(239, 68, 68, 0.7)',
            'rgba(99, 102, 241, 0.7)'
          ]
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { position: 'bottom' } }
      }
    });
  }
});


// ===== AI COMPOSER LOGIC =====
const msgDraft = document.getElementById('msgDraft');
const msgDept = document.getElementById('msgDept');
const msgManager = document.getElementById('msgManager');
const btnGenerate = document.getElementById('btnGenerate');
const btnSend = document.getElementById('btnSend');
const btnEdit = document.getElementById('btnEdit');
const previewArea = document.getElementById('previewArea');
const previewActions = document.getElementById('previewActions');
const aiStatus = document.getElementById('aiStatus');

function simulateAIGeneration(draft, dept, manager) {
  const deptName = msgDept.options[msgDept.selectedIndex].text;
  const managerName = msgManager.options[msgManager.selectedIndex].text;
  
  const templates = [
    `Dear Team in <b>${deptName}</b>,<br><br>I hope you're all doing well. ${draft ? draft : 'I wanted to reach out regarding our upcoming schedule.'}<br><br>Please note that this has been approved by <b>${managerName}</b>. Let us know if you have any questions.<br><br>Best regards,<br>HR Department`,
    
    `Attention: <b>${deptName}</b> Department,<br><br>This is a formal update regarding: <i>"${draft ? draft : 'General Policy Update'}"</i>.<br><br>As discussed with <b>${managerName}</b>, we are implementing these changes effective immediately. Thank you for your cooperation.<br><br>Regards,<br>Human Resources`,
    
    `Hi everyone,<br><br>Quick update for <b>${deptName}</b>: ${draft ? draft : 'Please check your portal for the latest updates.'}<br><br>This message was coordinated with <b>${managerName}</b> to ensure alignment. Have a great day!<br><br>Best,<br>HRFlow Team`
  ];
  
  return templates[Math.floor(Math.random() * templates.length)];
}

if (btnGenerate) {
  btnGenerate.addEventListener('click', () => {
    const draft = msgDraft.value.trim();
    
    // Loading state
    btnGenerate.disabled = true;
    btnGenerate.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Refining Draft...';
    previewArea.innerHTML = '<div class="preview-placeholder"><div class="typing-indicator"><span></span><span></span><span></span></div><p>AI is thinking...</p></div>';
    
    setTimeout(() => {
      const refined = simulateAIGeneration(draft);
      previewArea.innerHTML = `<div class="preview-content">${refined}</div>`;
      previewArea.style.borderStyle = 'solid';
      previewActions.style.display = 'flex';
      aiStatus.style.display = 'inline-block';
      
      btnGenerate.disabled = false;
      btnGenerate.innerHTML = '<i class="fa-solid fa-wand-magic-sparkles"></i> Regenerate Draft';
      
      // Auto-scroll to preview on mobile
      if (window.innerWidth < 900) {
        previewArea.scrollIntoView({ behavior: 'smooth' });
      }
    }, 1500);
  });
}

if (btnEdit) {
  btnEdit.addEventListener('click', () => {
    const isEditing = btnEdit.textContent.includes('Save');
    const content = previewArea.querySelector('.preview-content');
    
    if (!content) return;

    if (!isEditing) {
      // Start Editing
      content.contentEditable = "true";
      content.focus();
      content.style.outline = "2px solid var(--primary)";
      content.style.padding = "0.5rem";
      content.style.borderRadius = "8px";
      content.style.background = "#fff";
      btnEdit.innerHTML = '<i class="fa-solid fa-save"></i> Save';
      showToast('Editor Enabled', 'You can now edit the AI draft directly.', 'info');
    } else {
      // Save Editing
      content.contentEditable = "false";
      content.style.outline = "none";
      content.style.padding = "0";
      content.style.background = "transparent";
      btnEdit.innerHTML = '<i class="fa-solid fa-edit"></i> Edit';
      showToast('Draft Saved', 'Your manual changes have been preserved.', 'success');
    }
  });
}


if (btnSend) {
  btnSend.addEventListener('click', async () => {
    const previewContent = previewArea.querySelector('.preview-content')?.innerText;
    const title = "HR Announcement";
    const dept = msgDept.value;
    const manager = msgManager.value;

    // Store in Firebase Direct
    btnSend.disabled = true;
    btnSend.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Sending...';
    
    try {
      await addDoc(collection(db, 'messages'), { 
        title, 
        message: previewContent || "", 
        dept, 
        manager, 
        timestamp: new Date().toISOString() 
      });
      
      showToast('Message Stored', 'Announcement saved in Firestore Cloud.', 'success');
      
      // Reset UI
      if (msgDraft) msgDraft.value = '';
      previewArea.innerHTML = `
        <div class="preview-placeholder">
          <i class="fa-solid fa-robot"></i>
          <p>AI refined content will appear here...</p>
        </div>`;
      previewArea.style.borderStyle = 'dashed';
      previewActions.style.display = 'none';
      aiStatus.style.display = 'none';
      btnGenerate.innerHTML = '<i class="fa-solid fa-wand-magic-sparkles"></i> Generate AI Draft';
    } catch (err) {
      console.error('Firestore Send Error:', err);
      showToast('Storage Error', 'Failed to process message storage.', 'error');
    } finally {
      btnSend.disabled = false;
      btnSend.innerHTML = '<i class="fa-solid fa-paper-plane"></i> Send Message';
    }
  });
}

// ===== UTILITIES: NOTIFICATIONS (TOASTS) =====
function playNotifSound() {
  try {
    const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    const oscillator = audioCtx.createOscillator();
    const gainNode = audioCtx.createGain();

    oscillator.type = 'sine';
    oscillator.frequency.setValueAtTime(880, audioCtx.currentTime); // A5
    oscillator.frequency.exponentialRampToValueAtTime(440, audioCtx.currentTime + 0.5);

    gainNode.gain.setValueAtTime(0.1, audioCtx.currentTime);
    gainNode.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + 0.5);

    oscillator.connect(gainNode);
    gainNode.connect(audioCtx.destination);

    oscillator.start();
    oscillator.stop(audioCtx.currentTime + 0.5);
  } catch (e) {
    console.warn('Audio feedback not supported or blocked by browser policy.');
  }
}

function showToast(title, message, type = 'info') {
  playNotifSound();
  let container = document.querySelector('.toast-container');
  if (!container) {
    container = document.createElement('div');
    container.className = 'toast-container';
    document.body.appendChild(container);
  }

  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  
  const icons = {
    success: 'fa-circle-check',
    error: 'fa-circle-xmark',
    warning: 'fa-triangle-exclamation',
    info: 'fa-circle-info'
  };

  toast.innerHTML = `
    <i class="fa-solid ${icons[type]} toast-icon"></i>
    <div class="toast-content">
      <div class="toast-title">${title}</div>
      <div class="toast-msg">${message}</div>
    </div>
  `;

  container.appendChild(toast);

  // Remove toast after 4s
  setTimeout(() => {
    toast.classList.add('hide');
    setTimeout(() => toast.remove(), 300);
  }, 4000);
}

// ===== SIMULATED API SERVICE =====
const MockApi = {
  fetchEmployees: function() {
    if (globalLoader) globalLoader.classList.add('active');
    return new Promise((resolve) => {
      setTimeout(() => {
        if (globalLoader) globalLoader.classList.remove('active');
        resolve(attendanceData);
      }, 800);
    });
  },
  
  deleteEmployee: function(id) {
    if (globalLoader) globalLoader.classList.add('active');
    return new Promise((resolve) => {
      setTimeout(() => {
        if (globalLoader) globalLoader.classList.remove('active');
        console.log(`Deleted employee ${id}`);
        resolve({ success: true });
      }, 500);
    });
  },

  updateSettings: function(data) {
    if (globalLoader) globalLoader.classList.add('active');
    return new Promise((resolve) => {
      setTimeout(() => {
        if (globalLoader) globalLoader.classList.remove('active');
        resolve({ success: true, data });
      }, 1200);
    });
  }
};

// ===== DATA HANDLING & FILTERING =====
function filterData(data, query, fields) {
  if (!query) return data;
  const s = query.toLowerCase();
  return data.filter(item => 
    fields.some(field => String(item[field]).toLowerCase().includes(s))
  );
}

// ===== MODAL CONTROLLER =====
const modalOverlay = document.getElementById('modalOverlay');
const modalTitle = document.getElementById('modalTitle');
const modalBody = document.getElementById('modalBody');
const btnCloseModal = document.getElementById('btnCloseModal');
const btnCancelModal = document.getElementById('btnCancelModal');
const btnConfirmModal = document.getElementById('btnConfirmModal');

function openModal(title, bodyHtml, onConfirm) {
  if (!modalOverlay) return;
  modalTitle.textContent = title;
  modalBody.innerHTML = bodyHtml;
  modalOverlay.classList.add('active');
  
  const confirmHandler = () => {
    if (onConfirm) onConfirm();
    closeModal();
    btnConfirmModal.removeEventListener('click', confirmHandler);
  };
  
  btnConfirmModal.addEventListener('click', confirmHandler);
}

function closeModal() {
  if (modalOverlay) modalOverlay.classList.remove('active');
}

if (btnCloseModal) btnCloseModal.onclick = closeModal;
if (btnCancelModal) btnCancelModal.onclick = closeModal;
if (modalOverlay) {
  modalOverlay.onclick = (e) => { if (e.target === modalOverlay) closeModal(); };
}

// ===== REUSABLE BUTTON HANDLERS =====
document.addEventListener('click', (e) => {
  const btn = e.target.closest('.btn, .action-btn, .icon-btn');
  if (!btn) return;

  // View Employee Details (Custom Professional Modal)
  if (btn.textContent.includes('View')) {
    const row = btn.closest('tr');
    if (!row) return;

    const name = row.querySelector('b')?.textContent || 'Unknown';
    const id = row.querySelector('td:nth-child(2)')?.textContent || 'N/A';
    const dept = row.querySelector('td:nth-child(3)')?.textContent || 'General';
    const initials = row.querySelector('.avatar')?.textContent || '??';
    const avatarColor = row.querySelector('.avatar')?.style.backgroundColor || 'var(--primary)';

    openModal('Employee Profile', `
      <div style="text-align:center; padding: 1rem 0;">
        <div class="avatar" style="width:80px; height:80px; font-size:2rem; margin:0 auto 1.5rem; background:${avatarColor}; color:white; display:flex; align-items:center; justify-content:center; border-radius:50%; box-shadow:0 10px 20px rgba(0,0,0,0.1);">
          ${initials}
        </div>
        <h2 style="color:var(--text); margin-bottom:0.5rem;">${name}</h2>
        <div style="display:inline-block; padding:0.4rem 1rem; background:#eff6ff; color:#3b82f6; border-radius:100px; font-weight:600; font-size:0.85rem; margin-bottom:1.5rem;">
          ${dept}
        </div>
        
        <div style="display:grid; grid-template-columns:1fr 1fr; gap:1rem; text-align:left; background:var(--bg); padding:1.5rem; border-radius:12px; border:1px solid #e2e8f0;">
          <div>
            <div style="font-size:0.75rem; color:var(--text-2); text-transform:uppercase; letter-spacing:1px; margin-bottom:0.3rem;">Employee ID</div>
            <div style="font-weight:700; color:var(--text);">${id}</div>
          </div>
          <div>
            <div style="font-size:0.75rem; color:var(--text-2); text-transform:uppercase; letter-spacing:1px; margin-bottom:0.3rem;">Status</div>
            <div style="color:#10b981; font-weight:700;"><i class="fa-solid fa-circle" style="font-size:8px; vertical-align:middle; margin-right:5px;"></i> Active</div>
          </div>
        </div>
        
        <p style="margin-top:1.5rem; color:var(--text-2); font-size:0.9rem; line-height:1.5;">
          Currently assigned to the <b>${dept}</b> team. This employee has maintained 98% attendance this quarter.
        </p>
      </div>
    `, () => {
      console.log('Profile viewed');
    });
    return;
  }

  // Quick Actions Logic
  if (btn.textContent.includes('Add Employee')) {
    const autoId = `EMP-${Math.floor(1000 + Math.random() * 9000)}`;
    const hrId = localStorage.getItem('hr_user_id') || 'HR-ADMIN';
    
    openModal('Add New Employee', `
      <div class="settings-form">
        <div class="form-row">
          <label>HR Manager ID</label>
          <input type="text" id="hrManagerId" value="${hrId}" class="form-input" readonly style="background:var(--bg); color:#10b981; font-weight:700;"/>
        </div>
        <div class="form-row">
          <label>Employee ID (Auto)</label>
          <input type="text" id="newEmpId" value="${autoId}" class="form-input" readonly style="background:var(--bg); color:var(--primary); font-weight:700;"/>
        </div>
        <div class="form-row">
          <label>Full Name</label>
          <input type="text" id="newEmpName" placeholder="John Doe" class="form-input"/>
        </div>
        <div class="form-row">
          <label>Email</label>
          <input type="email" id="newEmpEmail" placeholder="john@company.com" class="form-input"/>
        </div>
        <div class="form-row">
          <label>Department</label>
          <select id="newEmpDept" class="form-input">
            <option>Engineering</option>
            <option>Marketing</option>
            <option>Design</option>
            <option>HR</option>
            <option>Sales</option>
          </select>
        </div>
      </div>
    `, async () => {
      const id = document.getElementById('newEmpId').value;
      const hId = document.getElementById('hrManagerId').value;
      const name = document.getElementById('newEmpName').value.trim();
      const email = document.getElementById('newEmpEmail').value.trim();
      const dept = document.getElementById('newEmpDept').value;
      
      if (!name || !email) {
        showToast('Error', 'Please fill in all required fields.', 'error');
        return;
      }

      try {
        // 2. Direct Firestore storage
        await addDoc(collection(db, 'employees'), {
          id, 
          hrId: hId,
          name, 
          email, 
          dept,
          status: 'present',
          createdAt: new Date().toISOString(),
          initials: name.split(' ').map(n => n[0]).join('').toUpperCase()
        });

        showToast('Success', `Employee ${id} added and saved to Firebase!`, 'success');
        if (typeof loadDashboardData === 'function') loadDashboardData();
      } catch (err) {
        console.error('Firestore Add Error:', err);
        showToast('Storage Error', 'Could not save employee to Cloud Firestore.', 'error');
      }
    });
  } else if (btn.textContent.includes('Run Payroll')) {
    openModal('Process Payroll', `
      <div style="text-align:center; padding:1rem 0;">
        <i class="fa-solid fa-money-check-dollar" style="font-size:3rem; color:var(--primary); margin-bottom:1rem;"></i>
        <h3>Confirm Payroll Run</h3>
        <p>Process salaries for all employees for <b>${new Date().toLocaleString('default', { month: 'long' })} ${new Date().getFullYear()}</b>.</p>
      </div>
    `, async () => {
      showToast('Payroll', 'Processing salaries...', 'info');
      try {
        const empSnap = await getDocs(collection(db, 'employees'));
        const allEmps = empSnap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        for (const emp of allEmps) {
          await addDoc(collection(db, 'payroll'), { employeeId: emp.id, employeeName: emp.name, amount: '₹45,000', status: 'Processed', processedAt: new Date().toISOString() });
          await sendNotification(emp.id, 'Payroll Processed', `Your salary for ${new Date().toLocaleString('default', { month: 'long' })} has been processed.`, 'payroll');
        }
        showToast('Success', 'Payroll processed and notifications sent!', 'success');
      } catch (err) {
        console.error('Payroll processing error:', err);
        showToast('Error', 'Failed to process payroll.', 'error');
      }
    });
  } else if (btn.textContent.includes('Add Leave')) {
    openModal('Submit Leave Request', `
      <div class="settings-form">
        <div class="form-row"><label>Reason</label><input type="text" id="leaveReason" placeholder="Vacation, Sick, etc." class="form-input"/></div>
        <div class="form-row"><label>Start Date</label><input type="date" id="leaveStart" class="form-input"/></div>
        <div class="form-row"><label>End Date</label><input type="date" id="leaveEnd" class="form-input"/></div>
      </div>
    `, async () => {
      const leaveData = {
        reason: document.getElementById('leaveReason').value,
        start: document.getElementById('leaveStart').value,
        end: document.getElementById('leaveEnd').value,
        status: 'pending',
        submittedAt: new Date().toISOString()
      };
      
      try {
        await addDoc(collection(db, 'leave_requests'), leaveData);
        showToast('Success', 'Leave request stored in Firebase Cloud.', 'success');
      } catch (e) {
        console.error('Firestore Leave Error:', e);
        showToast('Storage Error', 'Could not save leave request.', 'error');
      }
    });
  } else if (btn.textContent.includes('Export Report')) {
    navigateTo('reports');
    showToast('Export', 'Redirecting to reports for export...', 'warning');
  } else if (btn.textContent === 'Edit' && btn.closest('.card')?.querySelector('h3')?.textContent.includes('Corporate Account')) {
    const hrId = localStorage.getItem('hr_user_id') || 'HR-ADMIN';
    const primaryKey = `BANK-${Math.floor(1000 + Math.random() * 9000)}`;
    
    // Get current values from UI
    const currName = document.getElementById('uiBankName')?.textContent || 'Chase Business Plus';
    const currRouting = document.getElementById('uiBankRouting')?.textContent.replace('Routing: ', '') || '123456789';
    const currAcc = document.getElementById('uiBankAcc')?.textContent || '•••• •••• •••• 8842';

    openModal('Edit Corporate Account', `
      <div class="settings-form">
        <div class="form-row">
          <label>Bank Record ID (Primary Key)</label>
          <input type="text" id="bankPrimaryKey" value="${primaryKey}" class="form-input" readonly style="background:var(--bg); color:var(--primary); font-weight:700;"/>
        </div>
        <div class="form-row">
          <label>HR Manager ID</label>
          <input type="text" id="bankHrId" value="${hrId}" class="form-input" readonly style="background:var(--bg); color:#10b981; font-weight:700;"/>
        </div>
        <div class="form-row">
          <label>Bank Name</label>
          <input type="text" id="bankName" value="${currName}" class="form-input"/>
        </div>
        <div class="form-row">
          <label>Routing Number</label>
          <input type="text" id="bankRouting" value="${currRouting}" class="form-input"/>
        </div>
        <div class="form-row">
          <label>Account Number</label>
          <input type="text" id="bankAcc" value="${currAcc}" class="form-input"/>
        </div>
      </div>
    `, async () => {
      const bankData = {
        primaryKey: document.getElementById('bankPrimaryKey').value,
        hrId: document.getElementById('bankHrId').value,
        name: document.getElementById('bankName').value,
        routing: document.getElementById('bankRouting').value,
        account: document.getElementById('bankAcc').value,
        updatedAt: new Date().toISOString()
      };

      try {
        await addDoc(collection(db, 'bank_details'), bankData);
        showToast('Success', 'Bank details saved to Cloud Firestore.', 'success');
        loadBankDetails(); // Refresh UI
      } catch (err) {
        console.error('Firestore Bank Error:', err);
        showToast('Storage Error', 'Could not save bank details.', 'error');
      }
    });
  } else if (btn.classList.contains('icon-btn') && btn.title === 'Notifications') {
    // Handled elsewhere
  }
});

console.log('HRFlow JavaScript functionality initialized.');


// ===== NOTIFICATIONS SYSTEM =====
const btnNotif = document.getElementById('btnNotif');
const notifDropdown = document.getElementById('notifDropdown');
const notifList = document.getElementById('notifList');
const notifDot = document.getElementById('notifDot');

// Notification Sound (CDN)
const notifSound = new Audio('https://assets.mixkit.co/active_storage/sfx/2869/2869-preview.mp3');

const notifications = [
  { id: 1, type: 'leave', user: 'JD', name: 'Jane Doe', msg: 'submitted a leave request for <b>May 12-14</b>.', time: '2 min ago', unread: true },
  { id: 2, type: 'late', user: 'MK', name: 'Mike King', msg: 'clocked in <b>15 minutes late</b> today.', time: '14 min ago', unread: true },
  { id: 3, type: 'payroll', user: 'LM', name: 'Leo Mars', msg: 'payroll has been processed and sent.', time: '3 hrs ago', unread: false },
];

function renderNotifications() {
  if (!notifList) return;
  notifList.innerHTML = notifications.map(n => `
    <div class="notif-item ${n.unread ? 'unread' : ''}" data-id="${n.id}">
      <div class="notif-img">${n.user}</div>
      <div class="notif-body">
        <div class="notif-text"><b>${n.name}</b> ${n.msg}</div>
        <div class="notif-time">${n.time}</div>
      </div>
    </div>
  `).join('');

  const unreadCount = notifications.filter(n => n.unread).length;
  if (unreadCount > 0) {
    notifDot.classList.add('active');
    notifDot.textContent = unreadCount;
  } else {
    notifDot.classList.remove('active');
  }
}

function addNotification(notif) {
  notifications.unshift({ id: Date.now(), ...notif });
  renderNotifications();
  // Play sound
  notifSound.play().catch(e => console.log('Audio playback blocked by browser'));
  
  // Show toast
  showToast('New Notification', `${notif.name} ${notif.msg.replace(/<b>|<\/b>/g, '')}`, 'info');
}

if (btnNotif) {
  btnNotif.addEventListener('click', (e) => {
    e.stopPropagation();
    closeAllDropdowns(notifDropdown);
    notifDropdown.classList.toggle('show');
  });
}

document.addEventListener('click', () => {
  if (notifDropdown) notifDropdown.classList.remove('show');
});

if (notifDropdown) {
  notifDropdown.addEventListener('click', (e) => e.stopPropagation());
}

// Mark individual as read and show details
notifList?.addEventListener('click', (e) => {
  const item = e.target.closest('.notif-item');
  if (!item) return;
  
  const id = parseInt(item.dataset.id);
  const notif = notifications.find(n => n.id === id);
  
  if (notif) {
    notif.unread = false;
    renderNotifications();
    
    openModal('Notification Details', `
      <div style="text-align:center; padding:1.5rem 0;">
        <div class="notif-icon" style="width:60px; height:60px; font-size:1.5rem; margin:0 auto 1.5rem; background:var(--primary-light); color:var(--primary);">
          <i class="fa-solid fa-bell"></i>
        </div>
        <h3 style="margin-bottom:.5rem;">${notif.name}</h3>
        <p style="color:var(--text); line-height:1.5;">${notif.msg.replace(/<b>|<\/b>/g, '')}</p>
        <div style="margin-top:1.5rem; font-size:.8rem; color:var(--text-2);">${notif.time}</div>
      </div>
    `, null);
    const footer = document.querySelector('.modal-footer');
    if (footer) footer.style.display = 'none';
  }
});

// Mark all as read
document.querySelector('.mark-read')?.addEventListener('click', (e) => {
  e.stopPropagation();
  notifications.forEach(n => n.unread = false);
  renderNotifications();
  showToast('Notifications', 'All caught up!', 'success');
});

// ===== HEADER DROPDOWNS (MESSAGES & PROFILE) =====
const btnMessages = document.getElementById('btnMessages');
const msgDropdown = document.getElementById('msgDropdown');
const msgList = document.getElementById('msgList');
const btnProfile = document.getElementById('btnProfile');
const profileDropdown = document.getElementById('profileDropdown');

const messages = [
  { id: 1, user: 'AJ', name: 'Alice Johnson', text: 'Hey, did you review the payroll?', time: '5m ago', color: '#3b82f6', unread: true },
  { id: 2, user: 'MK', name: 'Mike King', text: 'Requesting sick leave for tomorrow.', time: '20m ago', color: '#f59e0b', unread: true }
];

function renderMessages() {
  if (!msgList) return;
  msgList.innerHTML = messages.map(m => `
    <div class="notif-item ${m.unread ? 'unread' : ''}" data-id="${m.id}">
      <div class="act-avatar" style="background:${m.color}">${m.user}</div>
      <div class="notif-body">
        <div class="notif-title">${m.name}</div>
        <div class="notif-text">${m.text}</div>
        <div class="notif-time">${m.time}</div>
      </div>
    </div>
  `).join('');
  
  const unreadCount = messages.filter(m => m.unread).length;
  const dot = btnMessages?.querySelector('.notif-dot');
  if (dot) {
    if (unreadCount > 0) {
      dot.classList.add('active');
      dot.textContent = unreadCount;
    } else {
      dot.classList.remove('active');
    }
  }
}

if (btnMessages) {
  btnMessages.addEventListener('click', (e) => {
    e.stopPropagation();
    closeAllDropdowns(msgDropdown);
    msgDropdown.classList.toggle('show');
    renderMessages();
  });
}

msgList?.addEventListener('click', (e) => {
  const item = e.target.closest('.notif-item');
  if (!item) return;
  
  const id = parseInt(item.dataset.id);
  const msg = messages.find(m => m.id === id);
  
  if (msg) {
    msg.unread = false;
    renderMessages();
    
    openModal(`Message from ${msg.name}`, `
      <div style="padding:1rem 0;">
        <div style="display:flex; align-items:center; gap:1rem; margin-bottom:1.5rem;">
          <div class="act-avatar" style="width:50px; height:50px; background:${msg.color}; font-size:1.2rem;">${msg.user}</div>
          <div>
            <div style="font-weight:700;">${msg.name}</div>
            <div style="font-size:.8rem; color:var(--text-2);">${msg.time}</div>
          </div>
        </div>
        <div style="background:var(--bg); padding:1.25rem; border-radius:12px; line-height:1.6; color:var(--text);">
          "${msg.text}"
        </div>
      </div>
    `, null);
    const footer = document.querySelector('.modal-footer');
    if (footer) footer.style.display = 'none';
  }
});

if (btnProfile) {
  btnProfile.addEventListener('click', (e) => {
    e.stopPropagation();
    closeAllDropdowns(profileDropdown);
    profileDropdown.classList.toggle('show');
  });
}

function closeAllDropdowns(except = null) {
  [notifDropdown, msgDropdown, profileDropdown].forEach(d => {
    if (d && d !== except) d.classList.remove('show');
  });
}

// Close all dropdowns on body click
document.addEventListener('click', () => {
  if (msgDropdown) msgDropdown.classList.remove('show');
  if (profileDropdown) profileDropdown.classList.remove('show');
  if (notifDropdown) notifDropdown.classList.remove('show');
});

// Prevent closing when clicking inside
[msgDropdown, profileDropdown, notifDropdown].forEach(el => {
  if (el) el.addEventListener('click', e => e.stopPropagation());
});

// Page links in dropdowns
document.querySelectorAll('.profile-menu a[data-page], #viewAllMsgs').forEach(link => {
  link.addEventListener('click', (e) => {
    e.preventDefault();
    if (link.id === 'viewAllMsgs') {
      navigateTo('ai-messaging');
    } else {
      navigateTo(link.dataset.page);
    }
    if (profileDropdown) profileDropdown.classList.remove('show');
    if (msgDropdown) msgDropdown.classList.remove('show');
  });
});

// ===== GLOBAL SEARCH (TOPBAR) =====
const topSearch = document.getElementById('topGlobalSearch');
const searchResults = document.getElementById('searchResults');

if (topSearch && searchResults) {
  topSearch.addEventListener('input', (e) => {
    const query = e.target.value.toLowerCase();
    if (query.length < 2) {
      searchResults.classList.remove('show');
      return;
    }
    
    // Search both employees and reports
    const employeeMatches = attendanceData.filter(emp => emp.name.toLowerCase().includes(query));
    const reportMatches = reports.filter(rep => rep.name.toLowerCase().includes(query));
    
    if (employeeMatches.length === 0 && reportMatches.length === 0) {
      searchResults.innerHTML = '<div class="search-item" style="color:var(--text-muted)">No results found</div>';
    } else {
      let html = '';
      employeeMatches.forEach(emp => {
        html += `<div class="search-item" data-type="employee" data-id="${emp.id}">
          <i class="fa-solid fa-user"></i>
          <span>${emp.name}</span>
          <span class="item-meta">Employee</span>
        </div>`;
      });
      reportMatches.forEach(rep => {
        html += `<div class="search-item" data-type="report">
          <i class="fa-solid fa-file-lines"></i>
          <span>${rep.name}</span>
          <span class="item-meta">Report</span>
        </div>`;
      });
      searchResults.innerHTML = html;
    }
    
    searchResults.classList.add('show');
    
    // Filter active page if applicable
    const activePage = document.querySelector('.page.active').id;
    if (activePage === 'page-attendance') {
      renderAttendance('all', query);
    }
  });

  // Handle result clicks
  searchResults.addEventListener('click', (e) => {
    const item = e.target.closest('.search-item');
    if (!item) return;
    
    const type = item.dataset.type;
    if (type === 'employee') {
      navigateTo('attendance');
      const attendSearch = document.getElementById('attendanceSearch');
      if (attendSearch) {
        attendSearch.value = item.querySelector('span').textContent;
        renderAttendance('all', attendSearch.value);
      }
    } else if (type === 'report') {
      navigateTo('reports');
    }
    
    topSearch.value = '';
    searchResults.classList.remove('show');
  });

  // Close search results on click outside
  document.addEventListener('click', (e) => {
    if (!topSearch.contains(e.target) && !searchResults.contains(e.target)) {
      searchResults.classList.remove('show');
    }
  });

  topSearch.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
      searchResults.classList.remove('show');
      showToast('Search', `Showing results for "${topSearch.value}"`, 'info');
    }
  });
}



// Simulate incoming notification after 5 seconds
setTimeout(() => {
  addNotification({
    type: 'onboarding',
    user: 'SR',
    name: 'Sarah Rose',
    msg: 'just completed her <b>onboarding documentation</b>.',
    time: 'Just now',
    unread: true
  });
}, 5000);

// Initialize
renderNotifications();
renderMessages();

// Handle disbursement item clicks
document.querySelector('#page-bank .activity-list')?.addEventListener('click', (e) => {
  const item = e.target.closest('.activity-item');
  if (!item) return;
  
  const title = item.querySelector('b').textContent;
  const amount = item.querySelector('.act-badge').textContent;
  const date = item.querySelector('.act-time').textContent;
  
  openModal('Disbursement Details', `
    <div style="text-align:center; padding: 1rem 0;">
      <i class="fa-solid fa-circle-check" style="font-size:3rem; color:var(--success); margin-bottom:1rem;"></i>
      <h3>${title}</h3>
      <div style="font-size:1.5rem; font-weight:700; margin:1rem 0;">${amount}</div>
      <p style="color:var(--text-2);">Processed on ${date}</p>
      <div style="margin-top:1.5rem; text-align:left; background:var(--bg); padding:1rem; border-radius:8px; font-size:.85rem;">
        <div style="display:flex; justify-content:space-between; margin-bottom:.5rem;"><span>Transaction ID</span><b>TXN-${Math.floor(Math.random()*1000000)}</b></div>
        <div style="display:flex; justify-content:space-between;"><span>Status</span><b style="color:var(--success);">Settled</b></div>
      </div>
    </div>
  `, null);
  // Hide footer buttons for this view-only modal
  const footer = document.querySelector('.modal-footer');
  if (footer) footer.style.display = 'none';
});

// ===== INTEGRATIONS HANDLERS =====
document.querySelector('#page-integration .stats-grid')?.addEventListener('click', (e) => {
  const btn = e.target.closest('button');
  if (!btn) return;
  
  const card = btn.closest('.card');
  const title = card.querySelector('h4').textContent;
  
  if (btn.textContent === 'Connect') {
    btn.disabled = true;
    btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Connecting...';
    
    setTimeout(() => {
      btn.disabled = false;
      btn.classList.add('connected');
      btn.innerHTML = '<i class="fa-solid fa-check-circle"></i> Connected';
      btn.style.background = 'var(--success)';
      btn.style.color = '#fff';
      showToast('Integration Successful', `${title} is now connected to HRFlow.`, 'success');
    }, 1500);
  } else if (btn.classList.contains('connected')) {
    if (confirm(`Are you sure you want to disconnect ${title}?`)) {
      btn.classList.remove('connected');
      btn.innerHTML = 'Connect';
      btn.style.background = '';
      btn.style.color = '';
      showToast('Disconnected', `${title} integration has been removed.`, 'warning');
    }
  } else if (btn.textContent === 'View Docs') {
    openModal('API Documentation', `
      <div style="font-size:.9rem; color:var(--text-2);">
        <p style="margin-bottom:1rem;">Welcome to the HRFlow REST API docs. Use these endpoints to automate your workforce management.</p>
        <div style="background:var(--bg); padding:1rem; border-radius:8px; font-family:monospace; margin-bottom:1rem;">
          <div style="margin-bottom:.5rem; color:var(--primary);">GET /api/v1/employees</div>
          <div style="color:var(--text-muted); font-size:.8rem;">Returns a list of all active employees.</div>
        </div>
        <div style="background:var(--bg); padding:1rem; border-radius:8px; font-family:monospace;">
          <div style="margin-bottom:.5rem; color:var(--success);">POST /api/v1/leave/request</div>
          <div style="color:var(--text-muted); font-size:.8rem;">Submit a new leave request for approval.</div>
        </div>
      </div>
    `, null);
    const footer = document.querySelector('.modal-footer');
    if (footer) footer.style.display = 'none';
  }
});

// ===== SETTINGS PAGE HANDLERS =====
const btnSaveSettings = document.getElementById('btnSaveSettings');
const setFullName = document.getElementById('setFullName');
const setEmail = document.getElementById('setEmail');
const setRole = document.getElementById('setRole');

async function loadSettings() {
  if (!auth.currentUser) return;
  try {
    const docRef = doc(db, 'users', auth.currentUser.uid);
    const snap = await getDoc(docRef);
    if (snap.exists()) {
      const data = snap.data();
      if (setFullName) setFullName.value = data.name || '';
      if (setEmail) setEmail.value = data.email || '';
      if (setRole) setRole.value = data.role || 'HR Manager';

      // Update Sidebar
      const sideName = document.querySelector('.user-name');
      const sideRole = document.querySelector('.user-role');
      if (sideName) sideName.textContent = data.name;
      if (sideRole) sideRole.textContent = data.role;
      
      const avatar = document.querySelector('.topbar-avatar');
      if (avatar) {
        const initials = (data.name || 'Admin').split(' ').map(n => n[0]).join('').toUpperCase();
        avatar.textContent = initials.substring(0, 2);
      }
    }
  } catch (e) {
    console.error('Settings load error:', e);
  }
}

if (btnSaveSettings) {
  btnSaveSettings.addEventListener('click', async () => {
    const newName = setFullName.value;
    const newRole = setRole.value;
    const newEmail = setEmail.value;

    btnSaveSettings.disabled = true;
    btnSaveSettings.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Saving...';
    
    try {
      // Direct Firestore update using User UID
      await setDoc(doc(db, 'users', auth.currentUser.uid), { 
        name: newName, 
        email: newEmail, 
        role: newRole, 
        updatedAt: new Date().toISOString() 
      });

      // Update UI locally
      const sideName = document.querySelector('.user-name');
      const sideRole = document.querySelector('.user-role');
      if (sideName) sideName.textContent = newName;
      if (sideRole) sideRole.textContent = newRole;
      
      const avatar = document.querySelector('.topbar-avatar');
      if (avatar) {
        const initials = newName.split(' ').map(n => n[0]).join('').toUpperCase();
        avatar.textContent = initials.substring(0, 2);
      }
      
      showToast('Settings Saved', 'Profile updated in Firebase Cloud successfully.', 'success');
    } catch (e) {
      console.error('Firestore Settings Error:', e);
      showToast('Storage Error', 'Failed to update profile in Cloud.', 'error');
    } finally {
      btnSaveSettings.disabled = false;
      btnSaveSettings.innerHTML = 'Save Changes';
    }
  });
}


// ===== CLOUD SYNC: SEED DATABASE =====
async function seedDatabase() {
  const btn = document.getElementById('btnSyncCloud');
  if (btn) {
    btn.disabled = true;
    btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i>';
  }
  
  showToast('Initializing...', 'Seeding your Firebase Cloud with demo data...', 'info');

  try {
    // 1. Employees
    const employees = [
      { name: 'Alice Johnson', email: 'alice@hrflow.com', dept: 'Engineering', role: 'Senior Engineer', color: '#3b82f6', initials: 'AJ' },
      { name: 'Bob Martinez', email: 'bob@hrflow.com', dept: 'Marketing', role: 'Lead', color: '#8b5cf6', initials: 'BM' },
      { name: 'Carol White', email: 'carol@hrflow.com', dept: 'Design', role: 'Designer', color: '#10b981', initials: 'CW' }
    ];
    for (const e of employees) await addDoc(collection(db, 'employees'), e);

    // 2. Attendance
    const attendance = [
      { id: 'EMP001', name: 'Alice Johnson', loginTime: '09:05 AM', status: 'present', color: '#3b82f6', initials: 'AJ' },
      { id: 'EMP002', name: 'Bob Martinez', loginTime: '09:45 AM', status: 'late', color: '#8b5cf6', initials: 'BM' },
      { id: 'EMP003', name: 'Carol White', loginTime: '--:--', status: 'absent', color: '#10b981', initials: 'CW' }
    ];
    for (const a of attendance) await addDoc(collection(db, 'attendance'), a);

    // 3. Payroll (Initial Set)
    for (const p of payrollData) {
      await addDoc(collection(db, 'payroll'), { ...p, processedAt: new Date().toISOString() });
    }

    // 4. Bank Details
    await addDoc(collection(db, 'bank_details'), { 
      account: '•••• •••• •••• 8842', 
      name: 'HDFC Business Plus', 
      routing: '021000021', 
      updatedAt: new Date().toISOString() 
    });

    showToast('Success!', 'Cloud database initialized. Reloading data...', 'success');
    setTimeout(() => loadDashboardData(), 1500);

  } catch (err) {
    console.error('Seeding Error:', err);
    showToast('Sync Failed', err.message, 'error');
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = '<i class="fa-solid fa-cloud-arrow-up"></i>';
    }
  }
}

const btnSyncCloud = document.getElementById('btnSyncCloud');
if (btnSyncCloud) {
  btnSyncCloud.addEventListener('click', seedDatabase);
}

// ===== BANK PAGE HANDLERS =====
const btnEditBank = document.getElementById('btnEditBank');
if (btnEditBank) {
  btnEditBank.addEventListener('click', () => {
    const currentName = document.getElementById('uiBankName')?.textContent || '';
    const currentAcc = document.getElementById('uiBankAcc')?.textContent || '';
    const currentRouting = document.getElementById('uiBankRouting')?.textContent.replace('Routing: ', '') || '';
    const currentBalance = document.getElementById('uiBankBalance')?.textContent.replace('₹', '') || '';

    openModal('Edit Corporate Bank Account', `
      <div class="settings-form">
        <div class="form-row"><label>Bank Name</label><input type="text" id="editBankName" value="${currentName}" class="form-input"/></div>
        <div class="form-row"><label>Account Number</label><input type="text" id="editBankAcc" value="${currentAcc}" class="form-input"/></div>
        <div class="form-row"><label>Routing Number</label><input type="text" id="editBankRouting" value="${currentRouting}" class="form-input"/></div>
        <div class="form-row"><label>Current Balance (₹)</label><input type="text" id="editBankBalance" value="${currentBalance}" class="form-input"/></div>
      </div>
    `, async () => {
      const name = document.getElementById('editBankName').value;
      const account = document.getElementById('editBankAcc').value;
      const routing = document.getElementById('editBankRouting').value;
      const balance = document.getElementById('editBankBalance').value;
      
      try {
        await addDoc(collection(db, 'bank_details'), { 
          name, 
          account, 
          routing, 
          balance,
          updatedAt: new Date().toISOString() 
        });
        showToast('Success', 'Bank details updated in cloud.', 'success');
        loadBankDetails();
      } catch (e) {
        console.error('Bank Update Error:', e);
        showToast('Error', 'Failed to update bank details.', 'error');
      }
    });
  });
}

// ===== END OF APPLICATION =====
console.log('HRFlow Dashboard fully connected to Firestore Cloud.');


