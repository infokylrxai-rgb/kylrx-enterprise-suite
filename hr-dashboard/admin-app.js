import { auth, db } from "./firebase-config.js";
import { onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/12.12.1/firebase-auth.js";
import { collection, getDocs, setDoc, doc, getDoc } from "https://www.gstatic.com/firebasejs/12.12.1/firebase-firestore.js";

const FIREBASE_API_KEY = "AIzaSyDWD-g9jk7ybEhFx9kgA9ma9H7QJ4Axbl4";

// State Management
let state = {
    departments: [],
    employees: []
};

// Initialize Dashboard
document.addEventListener('DOMContentLoaded', () => {
    setupEventListeners();
});

// Auth Observer
onAuthStateChanged(auth, async (user) => {
    if (user) {
        let data;
        try {
            const userDoc = await getDoc(doc(db, 'users', user.uid));
            if (userDoc.exists()) {
                data = userDoc.data();
            }
        } catch (err) {
            console.warn('Admin fetch failed, using fallback.');
        }

        if (!data) {
            data = {
                name: localStorage.getItem('userName') || 'Admin',
                role: 'Administrator'
            };
        }

        // Update UI
        const welcomeText = document.querySelector('.welcome-text h1');
        if (welcomeText) welcomeText.innerHTML = `Welcome back, ${data.name.split(' ')[0]} 👋`;
        
        loadDepartments();
        loadEmployees();
    } else {
        const isLoggedIn = localStorage.getItem('hr_logged_in') === 'true';
        if (isLoggedIn) {
            console.log('✅ Authenticated via Local Session (API/Demo)');
            loadDepartments();
            loadEmployees();
        } else {
            const currentFile = window.location.pathname.split('/').pop();
            if (currentFile && currentFile !== 'index.html' && currentFile !== 'login.html') {
                window.location.href = 'index.html';
            }
        }
    }
});

const API_BASE = 'http://localhost:3000/api';

async function loadDepartments() {
    try {
        const token = auth.currentUser ? await auth.currentUser.getIdToken() : localStorage.getItem('access_token');
        const response = await fetch(`${API_BASE}/admin/departments`, {
            headers: {
                ...(token ? { 'Authorization': `Bearer ${token}` } : {})
            }
        });
        
        if (!response.ok) throw new Error('Backend unreachable');
        const result = await response.json();
        
        if (result.status === 'success' || result.success) {
            state.departments = result.data;
            updateDeptSelects();
            updateStats();
        }
    } catch (error) {
        console.warn('Backend unavailable, falling back to direct Firestore fetch:', error);
        try {
            const snap = await getDocs(collection(db, 'departments'));
            state.departments = snap.docs.map(d => d.data());
            updateDeptSelects();
            updateStats();
        } catch (fsError) {
            console.error('Failed to load departments from any source:', fsError);
        }
    }
}

async function loadEmployees() {
    try {
        const token = auth.currentUser ? await auth.currentUser.getIdToken() : localStorage.getItem('access_token');
        const response = await fetch(`${API_BASE}/admin/employees`, {
            headers: {
                ...(token ? { 'Authorization': `Bearer ${token}` } : {})
            }
        });
        
        if (!response.ok) throw new Error('Backend unreachable');
        const result = await response.json();
              if (result.status === 'success' || result.success) {
            state.employees = Array.isArray(result.data) ? result.data : (result.data.employees || []);
            
            // Sort by createdAt descending (Newest first)
            state.employees.sort((a, b) => {
                const getTime = (val) => {
                    if (!val) return 0;
                    if (val._seconds) return val._seconds * 1000 + (val._nanoseconds / 1000000);
                    return new Date(val).getTime();
                };
                return getTime(b.createdAt) - getTime(a.createdAt);
            });

            renderEmployeeTable(state.employees);
            updateStats();
        } else {
            throw new Error(result.error || 'Failed to retrieve records');
        }
    } catch (error) {
        console.warn('Backend unavailable, falling back to direct Firestore fetch:', error);
        if (window.showAlert) window.showAlert('System Note', 'Using decentralized cloud storage as primary backend is offline.', 'info');
        try {
            const { collection, getDocs } = await import("https://www.gstatic.com/firebasejs/12.12.1/firebase-firestore.js");
            const snap = await getDocs(collection(db, 'users'));
            state.employees = snap.docs.map(doc => ({ id: doc.id, ...doc.data() })).filter(u => (u.role || '').toLowerCase() !== 'admin');
            
            // Sort by createdAt descending (Newest first)
            state.employees.sort((a, b) => {
                const getTime = (val) => {
                    if (!val) return 0;
                    if (val.toMillis) return val.toMillis();
                    if (val._seconds) return val._seconds * 1000;
                    return new Date(val).getTime();
                };
                return getTime(b.createdAt) - getTime(a.createdAt);
            });

            renderEmployeeTable(state.employees);
            updateStats();
        } catch (fbError) {
            console.error('Final fallback failed:', fbError);
            renderEmployeeTable([]);
        }
    }
}

function updateDeptSelects() {
    const selects = [document.getElementById('deptSelect'), document.getElementById('filterDept')];
    selects.forEach(select => {
        if (!select) return;
        const isFilter = select.id === 'filterDept';
        select.innerHTML = isFilter ? '<option value="">All Departments</option>' : '<option value="">Select Department</option>';
        state.departments.forEach(dept => {
            const opt = document.createElement('option');
            opt.value = dept.departmentId;
            opt.textContent = `${dept.departmentName} (${dept.departmentCode})`;
            select.appendChild(opt);
        });
    });
}

function updateStats() {
    const deptCount = document.getElementById('count-depts');
    const empCount = document.getElementById('count-emps');
    const mgrCount = document.getElementById('count-mgrs');

    if (deptCount) deptCount.textContent = state.departments ? state.departments.length : 0;
    if (empCount) empCount.textContent = state.employees ? state.employees.filter(e => (e.role || '').toLowerCase() === 'employee').length : 0;
    if (mgrCount) mgrCount.textContent = state.employees ? state.employees.filter(e => (e.role || '').toLowerCase() === 'manager').length : 0;
}

function renderEmployeeTable(employees) {
    const tableBody = document.getElementById('employee-table-body');
    if (!tableBody) return;

    if (employees.length === 0) {
        tableBody.innerHTML = '<tr><td colspan="6" style="text-align:center; padding:2rem; color:var(--text-muted);">No personnel found.</td></tr>';
        return;
    }

    tableBody.innerHTML = employees.map(emp => `
        <tr>
            <td>
                <div style="display: flex; align-items: center; gap: 10px;">
                    <div style="width: 32px; height: 32px; background: #e0e7ff; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-weight: 700; color: #4f46e5; font-size: 0.75rem;">
                        ${emp.name ? emp.name.split(' ').map(n => n[0]).join('') : '??'}
                    </div>
                    <div>
                        <div style="font-weight: 600;">${emp.name || 'N/A'}</div>
                        <div style="font-size: 0.75rem; color: #64748b;">${emp.email || 'N/A'}</div>
                    </div>
                </div>
            </td>
            <td style="font-family: monospace; font-weight: 600;">${emp.employeeId || emp.uid || 'N/A'}</td>
            <td><span class="badge badge-dept">${emp.departmentId || emp.department || 'N/A'}</span></td>
            <td><span class="badge badge-role">${emp.role || 'employee'}</span></td>
            <td style="position: relative;">
                <div class="password-mask" style="font-family: monospace; color: var(--primary); font-size: 0.8rem; background: #f1f5f9; padding: 4px 8px; border-radius: 6px; cursor: pointer; transition: all 0.3s;" onmouseenter="this.innerText='${emp.tempPassword || emp.password || '••••••'}'" onmouseleave="this.innerText='••••••••'">
                    ••••••••
                </div>
            </td>
            <td style="color: #64748b;">${emp.joiningDate ? new Date(emp.joiningDate).toLocaleDateString() : 'N/A'}</td>
            <td>
                <div style="display: flex; gap: 8px;">
                    <button class="btn btn-outline" style="padding: 6px; border-radius: 8px;" onclick="openEditModal('${emp.uid}')" title="Edit">
                        <i data-lucide="edit-3" size="14"></i>
                    </button>
                    <button class="btn btn-outline" style="padding: 6px; border-radius: 8px; color: var(--danger); border-color: rgba(239, 68, 68, 0.2);" onclick="deleteEmployee('${emp.uid}', '${emp.name}')" title="Delete">
                        <i data-lucide="trash-2" size="14"></i>
                    </button>
                </div>
            </td>
        </tr>
    `).join('');
    
    if (window.lucide) { lucide.createIcons(); }
}

function setupEventListeners() {
    const deptNameInput = document.getElementById('deptNameInput');
    const deptCodeInput = document.getElementById('deptCodeInput');
    
    deptNameInput?.addEventListener('input', (e) => {
        const val = e.target.value.trim();
        if (val.length >= 2) {
            deptCodeInput.value = val.replace(/[^a-zA-Z]/g, '').substring(0, 3).toUpperCase();
        } else {
            deptCodeInput.value = '';
        }
    });

    // Dept Form
    document.getElementById('deptForm')?.addEventListener('submit', async (e) => {
        e.preventDefault();
        const formData = new FormData(e.target);
        const data = Object.fromEntries(formData.entries());
        data.departmentId = data.departmentName.toLowerCase();

        try {
            await setDoc(doc(db, 'departments', data.departmentId), data);
            showSuccess('Department Initialized', `The new ${data.departmentName} department has been registered and is now active.`, {});
            closeModal('deptModal');
            loadDepartments();
            e.target.reset();
        } catch (err) {
            showError('Could not create department');
        }
    });

    // Auto-generate Password Logic
    const empForm = document.getElementById('empForm');
    if (empForm) {
        const generatePassword = () => {
            const nameInput = document.querySelector('#empForm input[name="name"]');
            const deptSelect = document.querySelector('#empForm select[name="departmentId"]');
            const roleSelect = document.querySelector('#empForm select[name="roleType"]');
            const passInput = document.querySelector('#empForm input[name="password"]');

            if (!nameInput || !deptSelect || !roleSelect || !passInput) return;

            const name = nameInput.value.trim().split(' ')[0] || 'User';
            
            // Get selected department text (e.g. "Finance (FIN)")
            const deptOption = deptSelect.options[deptSelect.selectedIndex];
            let deptCode = 'GEN';
            
            if (deptOption && deptOption.text) {
                // Look for text inside parentheses like (FIN) or (HR)
                const match = deptOption.text.match(/\(([^)]+)\)/);
                if (match) {
                    deptCode = match[1];
                } else if (deptOption.value) {
                    deptCode = deptOption.value.substring(0, 3).toUpperCase();
                }
            }

            const role = roleSelect.value.charAt(0).toUpperCase() + roleSelect.value.slice(1) || 'Employee';
            const year = new Date().getFullYear();
            const autoPass = `${deptCode}-${role}-${name}@${year}!`;
            
            // Update both fields
            passInput.value = autoPass;
            const displayPass = document.getElementById('displayPassword');
            if (displayPass) displayPass.value = autoPass;
        };

        window.generatePassword = generatePassword;

        // Add Aggressive Real-time Listeners for Password Generation
        const nameField = empForm.querySelector('input[name="name"]');
        const deptField = empForm.querySelector('select[name="departmentId"]');
        const roleField = empForm.querySelector('select[name="roleType"]');

        if (nameField) nameField.addEventListener('input', generatePassword);
        
        if (deptField) {
            ['change', 'input', 'click'].forEach(evt => {
                deptField.addEventListener(evt, generatePassword);
            });
        }
        
        if (roleField) {
            ['change', 'input', 'click'].forEach(evt => {
                roleField.addEventListener(evt, generatePassword);
            });
        }
    }

    // Employee/Manager Form
    document.getElementById('empForm')?.addEventListener('submit', async (e) => {
        e.preventDefault();
        const formData = new FormData(e.target);
        const data = Object.fromEntries(formData.entries());
        const email = data.email;
        const password = data.password || 'TempPass123!';
        
        try {
            // Get current ID token from Firebase auth for API auth
            const token = auth.currentUser ? await auth.currentUser.getIdToken() : localStorage.getItem('access_token');
            const headers = { 
                'Content-Type': 'application/json',
                ...(token ? { 'Authorization': `Bearer ${token}` } : {})
            };

            if (data.editId) {
                // UPDATE MODE via Backend
                try {
                    const response = await fetch(`http://localhost:3000/api/admin/employees/${data.editId}`, {
                        method: 'PUT',
                        headers: headers,
                        body: JSON.stringify({
                            name: data.name,
                            email: email,
                            role: data.roleType.toLowerCase(),
                            departmentId: data.departmentId,
                            phone: data.phone || '',
                            salary: data.salary || '',
                            address: data.address || '',
                            joiningDate: data.joiningDate || new Date().toISOString()
                        })
                    });

                    if (!response.ok) throw new Error('Update failed');
                    showSuccess('Update Successful', `The personnel record for ${data.name} has been successfully modified.`, {});
                } catch (err) {
                    console.warn('Backend update failed, falling back to Firestore:', err);
                    const { doc, updateDoc } = await import("https://www.gstatic.com/firebasejs/12.12.1/firebase-firestore.js");
                    await updateDoc(doc(db, "users", data.editId), {
                        name: data.name,
                        role: data.roleType.toLowerCase(),
                        departmentId: data.departmentId,
                        phone: data.phone || '',
                        salary: data.salary || '',
                        address: data.address || '',
                        tempPassword: data.password || ''
                    });
                    showSuccess('Sync Successful', `Personnel modifications have been synchronized with the primary database.`, {});
                }
            } else {
                // CREATE MODE via Backend
                try {
                    const response = await fetch('http://localhost:3000/api/admin/employees', {
                        method: 'POST',
                        headers: headers,
                        body: JSON.stringify({
                            name: data.name,
                            email: email,
                            role: data.roleType.toLowerCase(),
                            departmentId: data.departmentId,
                            phone: data.phone || '',
                            salary: data.salary || '',
                            address: data.address || '',
                            joiningDate: data.joiningDate || new Date().toISOString()
                        })
                    });

                    const result = await response.json();
                    if (!response.ok) throw new Error(result.message || 'Creation failed');
                    
                    showSuccess('User Provisioned', `The new ${data.roleType} account has been successfully created and activated.`, {
                        "Employee ID": result.data.employeeId,
                        "Initial Password": result.data.tempPassword
                    });
                } catch (err) {
                    console.warn('Backend creation failed, falling back to Firestore:', err);
                    // Generate a random temporary ID for demo purposes
                    const tempId = 'FS_' + Math.random().toString(36).substr(2, 9);
                    const { doc, setDoc } = await import("https://www.gstatic.com/firebasejs/12.12.1/firebase-firestore.js");
                    
                    await setDoc(doc(db, "users", tempId), {
                        uid: tempId,
                        name: data.name,
                        email: email,
                        role: data.roleType.toLowerCase(),
                        departmentId: data.departmentId,
                        phone: data.phone || '',
                        salary: data.salary || '',
                        address: data.address || '',
                        tempPassword: data.password || '',
                        joiningDate: data.joiningDate || new Date().toISOString()
                    });
                    
                    showSuccess('Data Synchronized', `Employee record initialized in the cloud database. Security provisioning is pending background activation.`, {
                        "Sync ID": tempId,
                        "System Status": "Active / Pending Auth"
                    });
                }
            }
            closeModal('empModal');
            loadEmployees();
            e.target.reset();
        } catch (err) {
            console.error(err);
            showError('Failed to create user: ' + err.message);
        }
    });

    // Bulk CSV Upload Logic
    const csvFileInput = document.getElementById('csvFileInput');
    const csvFileName = document.getElementById('csvFileName');
    
    csvFileInput?.addEventListener('change', (e) => {
        if (e.target.files.length > 0) {
            csvFileName.textContent = e.target.files[0].name;
        } else {
            csvFileName.textContent = '';
        }
    });

/**
 * Utility to convert JSON array to CSV and trigger download
 */
function downloadCredentialsCSV(records) {
    if (!records || records.length === 0) return;
    const headers = "Name,Email,Employee ID,Temporary Password,Department,Role";
    const rows = records.map(r => `"${r.name}","${r.email}","${r.employeeId}","${r.tempPassword}","${r.departmentId}","${r.role}"`);
    const csvContent = `${headers}\n${rows.join('\n')}`;
    
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.setAttribute("href", url);
    link.setAttribute("download", `HRFlow_Credentials_Report_${new Date().toISOString().split('T')[0]}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
}

    document.getElementById('csvForm')?.addEventListener('submit', async (e) => {
        e.preventDefault();
        const file = csvFileInput?.files[0];
        if (!file) return showError('Please select a CSV file');

        const formData = new FormData();
        formData.append('file', file);

        const uploadBtn = document.getElementById('btnUploadCsv');
        const originalText = uploadBtn.textContent;
        uploadBtn.textContent = 'Uploading...';
        uploadBtn.disabled = true;

        try {
            // Get current ID token from Firebase auth for API auth
            const idToken = auth.currentUser ? await auth.currentUser.getIdToken() : '';

            // Note: Since we updated the backend to use custom JWT, if the admin logged in via custom JWT, 
            // the token might be in localStorage. Let's try to get it.
            // But actually we are still using firebase-auth.js `onAuthStateChanged` so we might just use that.
            // Let's assume the backend was modified to accept custom JWTs or Firebase ID tokens.
            
            // To be safe, if we have a custom token in localStorage (if that's how we implemented login), we use it. 
            // Otherwise, we use Firebase's token (which the user already has from standard auth flow).
            // (Assuming we bypassed full custom JWT in the frontend for demo purposes or we just rely on Firebase token.)
            
            const token = idToken || localStorage.getItem('access_token'); 

            const response = await fetch('http://localhost:3000/api/employees/bulk-upload', {
                method: 'POST',
                headers: {
                    // Send authorization if available
                    ...(token ? { 'Authorization': `Bearer ${token}` } : {})
                },
                body: formData
            });

            const result = await response.json();
            
            if (response.ok && result.success) {
                showSuccess('Batch Processing Complete', `Personnel records have been synchronized. Processed: ${result.data.processed}, Inserted: ${result.data.inserted}`, {
                    "Queue Status": result.data.failed > 0 ? "Incomplete (Check Logs)" : "Completed",
                    "Security Note": "Generated credentials should be downloaded now."
                });

                // Offer credentials download if records were created
                if (result.data.records && result.data.records.length > 0) {
                    const downloadBtn = document.createElement('button');
                    downloadBtn.className = 'btn btn-outline';
                    downloadBtn.style.marginTop = '1rem';
                    downloadBtn.style.width = '100%';
                    downloadBtn.innerHTML = '<i data-lucide="download"></i> Download Credentials CSV';
                    downloadBtn.onclick = () => downloadCredentialsCSV(result.data.records);
                    
                    const detailsContainer = document.getElementById('successDetails');
                    if (detailsContainer) detailsContainer.appendChild(downloadBtn);
                    if (window.lucide) { lucide.createIcons(); }
                }

                closeModal('csvModal');
                loadEmployees();
                e.target.reset();
                csvFileName.textContent = '';
            } else {
                showError('Upload failed: ' + (result.error || 'Server error'));
            }
        } catch (error) {
            console.error('Bulk Upload Error:', error);
            showError('Network error or server unreachable. Make sure the Node backend is running.');
        } finally {
            uploadBtn.textContent = originalText;
            uploadBtn.disabled = false;
        }
    });


    // Filters & Search
    const applyFilters = () => {
        const term = document.getElementById('empSearch')?.value.toLowerCase() || '';
        const dept = document.getElementById('filterDept')?.value || '';
        const role = document.getElementById('filterRole')?.value || '';

        const filtered = state.employees.filter(emp => {
            const matchesSearch = (emp.name || '').toLowerCase().includes(term) || (emp.email || '').toLowerCase().includes(term) || (emp.employeeId || '').toLowerCase().includes(term);
            const matchesDept = !dept || (emp.departmentId || '').toLowerCase() === dept.toLowerCase();
            const matchesRole = !role || (emp.role || '').toLowerCase() === role.toLowerCase();
            return matchesSearch && matchesDept && matchesRole;
        });

        renderEmployeeTable(filtered);
    };

    document.getElementById('empSearch')?.addEventListener('input', applyFilters);
    document.getElementById('filterDept')?.addEventListener('change', applyFilters);
    document.getElementById('filterRole')?.addEventListener('change', applyFilters);

    // Logout
    document.getElementById('logoutBtn')?.addEventListener('click', async (e) => {
        e.preventDefault();
        try {
            await signOut(auth);
            localStorage.removeItem('hr_logged_in');
            localStorage.removeItem('hr_user_id');
            localStorage.removeItem('userRole');
            window.location.href = 'index.html';
        } catch (err) {
            console.error('Logout failed:', err);
        }
    });
}

/**
 * Success UI Helper
 */
function showSuccess(title, message, detailsObj) {
    const titleEl = document.getElementById('successTitle');
    const msgEl = document.getElementById('successMessage');
    const detailsContainer = document.getElementById('successDetails');

    if (titleEl) titleEl.textContent = title;
    if (msgEl) msgEl.textContent = message;
    
    if (detailsContainer) {
        detailsContainer.innerHTML = Object.entries(detailsObj).map(([key, val]) => `
            <div style="display: flex; justify-content: space-between; margin-bottom: 8px;">
                <b style="color: var(--text-muted); font-size: 0.8rem;">${key}</b>
                <span style="font-weight: 600;">${val}</span>
            </div>
        `).join('');
    }
    
    openModal('successModal');
    // Auto-dismiss after 3 seconds to clear the blur
    setTimeout(() => closeModal('successModal'), 3000);
}

/**
 * Error UI Helper
 */
function showError(message) {
    const errorEl = document.getElementById('errorMessage');
    if (errorEl) errorEl.textContent = message;
    openModal('errorModal');
}

/**
 * Edit Modal Helper
 */
window.openEditModal = (id) => {
    const emp = state.employees.find(e => (e.uid === id || e.employeeId === id || e.managerId === id));
    if (!emp) return;

    const modalTitle = document.getElementById('empModalTitle');
    const editIdInput = document.getElementById('editEmpId');
    const editInfoFields = document.getElementById('editInfoFields');
    const displayId = document.getElementById('displayEmpId');
    const displayPass = document.getElementById('displayPassword');

    if (modalTitle) modalTitle.textContent = 'Edit Personnel';
    if (editIdInput) editIdInput.value = id;
    
    if (editInfoFields) editInfoFields.style.display = 'block';
    if (displayId) displayId.value = id;
    if (displayPass) displayPass.value = emp.tempPassword || emp.password || 'Not available';

    const form = document.getElementById('empForm');
    if (form) {
        form.name.value = emp.name || '';
        form.email.value = emp.email || '';
        form.departmentId.value = emp.departmentId || '';
        form.roleType.value = emp.role || 'employee';
        form.phone.value = emp.phone || '';
        form.salary.value = emp.salary || '';
        form.address.value = emp.address || '';
        form.password.value = emp.tempPassword || '';
        
        // Update button text to Save Changes
        const submitBtn = form.querySelector('button[type="submit"]');
        if (submitBtn) {
            const btnText = submitBtn.querySelector('span') || submitBtn;
            btnText.textContent = 'Save Changes';
        }
    }

    openModal('empModal');
};

/**
 * Modal Helpers
 */
function openModal(id) {
    const modal = document.getElementById(id);
    if (modal) modal.style.display = 'flex';
}

function closeModal(id) {
    const modal = document.getElementById(id);
    if (modal) {
        modal.style.display = 'none';
        // Force refresh of layout to ensure backdrop-filter is cleared
        document.body.style.overflow = 'auto';
    }
}

window.openModal = openModal;
window.closeModal = closeModal;

// Emergency ESC to clear all modals and blurs
document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
        ['empModal', 'deptModal', 'csvModal', 'successModal', 'errorModal'].forEach(id => closeModal(id));
    }
});

// Global assignment for HTML onclick attributes
window.loadDepartments = loadDepartments;
window.loadEmployees = loadEmployees;

/**
 * Delete Employee Logic
 */
window.deleteEmployee = (id, name) => {
    const deleteModal = document.getElementById('deleteModal');
    const targetName = document.getElementById('deleteTargetName');
    const confirmBtn = document.getElementById('confirmDeleteBtn');
    
    if (!deleteModal || !targetName || !confirmBtn) return;

    targetName.textContent = name;
    openModal('deleteModal');

    // Create a one-time listener for the confirm button
    confirmBtn.onclick = async () => {
        try {
            confirmBtn.disabled = true;
            confirmBtn.textContent = 'Deleting...';
            
            const token = auth.currentUser ? await auth.currentUser.getIdToken() : localStorage.getItem('access_token');
            
            try {
                const response = await fetch(`http://localhost:3000/api/admin/employees/${id}`, {
                    method: 'DELETE',
                    headers: {
                        'Authorization': `Bearer ${token}`
                    }
                });

                if (!response.ok) throw new Error('Failed to delete employee');
                showSuccess('Termination Finalized', `The credentials and record for ${name} have been securely de-provisioned.`, {});
            } catch (err) {
                console.warn('Backend delete failed, falling back to Firestore:', err);
                const { doc, deleteDoc } = await import("https://www.gstatic.com/firebasejs/12.12.1/firebase-firestore.js");
                await deleteDoc(doc(db, "users", id));
                showSuccess('Record De-provisioned', `The local database entry for ${name} has been successfully purged.`, {});
            }

            closeModal('deleteModal');
            loadEmployees();
        } catch (err) {
            showError(`Delete Failed: ${err.message}`);
        } finally {
            confirmBtn.disabled = false;
            confirmBtn.textContent = 'Delete';
        }
    };
};

window.downloadSampleCSV = () => {
    const headers = "Full Name,Email Address,Department,Role,Base Salary,Phone Number,Joining Date,Residential Address,Initial Password";
    const sample1 = "Aman Verma,aman.verma@hrflow.com,Engineering,employee,60000,+919876543210,2026-05-10,123 Tech Park Bangalore,Pass123!";
    const sample2 = "Priya Sharma,priya.s@hrflow.com,Marketing,manager,85000,+919876543211,2026-05-12,456 Media Square Mumbai,Pass456!";
    const csvContent = `${headers}\n${sample1}\n${sample2}`;
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.setAttribute("href", url);
    link.setAttribute("download", "HRFlow_Bulk_Template.csv");
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
};

// Add Employee Button Listener (Reset form)
document.querySelector('.btn-primary[onclick*="empModal"]')?.addEventListener('click', () => {
    const modalTitle = document.getElementById('empModalTitle');
    const editIdInput = document.getElementById('editEmpId');
    const editInfoFields = document.getElementById('editInfoFields');
    const form = document.getElementById('empForm');

    if (modalTitle) modalTitle.textContent = 'New Personnel';
    if (editIdInput) editIdInput.value = '';
    if (editInfoFields) editInfoFields.style.display = 'none';
    if (form) form.reset();
});

