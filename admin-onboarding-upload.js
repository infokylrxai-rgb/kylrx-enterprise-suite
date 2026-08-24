import { auth, db, storage } from "./firebase-config.js";
import { 
    collection, 
    getDocs, 
    setDoc, 
    doc, 
    addDoc,
    query, 
    where, 
    serverTimestamp 
} from "https://www.gstatic.com/firebasejs/12.12.1/firebase-firestore.js";
import { ref, uploadBytes, getDownloadURL } from "https://www.gstatic.com/firebasejs/12.12.1/firebase-storage.js";

// Enterprise Upload Engine State
let state = {
    allRows: [],
    failedRows: [],
    successRows: [],
    existingEmails: [],
    existingEmployeeIds: [],
    managers: [],
    stats: { total: 0, success: 0, failed: 0, dupes: 0 },
    isProcessing: false
};

// Cross-port API Routing (supporting VS Code Live Server port 5501)
const apiBase = window.location.port === '3000' ? '' : 'http://127.0.0.1:3000';
const targetOrigin = window.location.port === '3000' ? window.location.origin : 'http://127.0.0.1:3000';

// UI Selectors
const dropZone = document.getElementById('dropZone');
const fileInput = document.getElementById('fileInput');
const btnDownload = document.getElementById('btnDownloadTemplate');
const resultsBody = document.getElementById('resultsBody');
const progressView = document.getElementById('progressView');
const resultsTable = document.getElementById('resultsTable');
const btnFinalize = document.getElementById('btnFinalize');
const retryBanner = document.getElementById('retryBanner');
const btnRetry = document.getElementById('btnRetryFailed');

const tabBulk = document.getElementById('tabBulk');
const tabManual = document.getElementById('tabManual');
const uploadView = document.getElementById('uploadView');
const manualView = document.getElementById('manualView');
const bulkHeaderActions = document.getElementById('bulkHeaderActions');
const manualOnboardForm = document.getElementById('manualOnboardForm');
const btnManualClear = document.getElementById('btnManualClear');

// Stats Elements
const elTotal = document.getElementById('statTotal');
const elSuccess = document.getElementById('statSuccess');
const elFailed = document.getElementById('statFailed');
const elDupes = document.getElementById('statDupes');

// Initialize
document.addEventListener('DOMContentLoaded', async () => {
    await fetchReferenceData();
    setupEvents();
});

async function fetchReferenceData() {
    try {
        const usersSnap = await getDocs(collection(db, 'users'));
        state.existingEmails = usersSnap.docs.map(d => d.data().email?.toLowerCase()).filter(Boolean);
        state.existingEmployeeIds = usersSnap.docs.map(d => d.data().employeeId?.toLowerCase()).filter(Boolean);
        state.managers = usersSnap.docs
            .map(d => ({ id: d.id, ...d.data() }))
            .filter(u => u.role?.toLowerCase() === 'manager');
        console.log("✅ Users fetched successfully");
    } catch (err) {
        console.error("❌ Users fetch failed, using fallback managers list", err);
    }

    // Ensure we always have fallback managers if loading fails or returns empty
    if (!state.managers || state.managers.length === 0) {
        state.managers = [
            { name: "CYBER", fullName: "CYBER", email: "cyber@gmail.com", role: "manager" },
            { name: "John", fullName: "John", email: "john@gmail.com", role: "manager" }
        ];
    }

    // Populate Manual Manager dropdown
    const manualManagerSelect = document.getElementById('manualManager');
    if (manualManagerSelect) {
        manualManagerSelect.innerHTML = '<option value="">Select Manager</option>';
        state.managers.forEach(m => {
            const opt = document.createElement('option');
            const mgrName = m.fullName || m.name || 'Unnamed Manager';
            opt.value = mgrName;
            opt.textContent = `${mgrName} (${m.email})`;
            manualManagerSelect.appendChild(opt);
        });
    }

    // Populate Manual Department dropdown from command_centers (Enterprise Builder)
    let departmentsList = [];
    try {
        const centersSnap = await getDocs(collection(db, 'command_centers'));
        centersSnap.forEach(docSnap => {
            const data = docSnap.data();
            if (data.name) departmentsList.push(data.name);
        });
        console.log("✅ Command centers fetched successfully");
    } catch (e) {
        console.error("❌ Command centers fetch failed, using fallback departments list", e);
    }

    if (departmentsList.length === 0) {
        departmentsList = ["Cybersecurity", "Engineering", "Marketing", "Finance", "HR"];
    }

    const uniqueDepts = [...new Set(departmentsList)].sort();
    const manualDeptSelect = document.getElementById('manualDept');
    if (manualDeptSelect) {
        manualDeptSelect.innerHTML = '<option value="">Select Department</option>';
        uniqueDepts.forEach(dept => {
            const opt = document.createElement('option');
            opt.value = dept;
            opt.textContent = dept;
            manualDeptSelect.appendChild(opt);
        });
    }
    
    console.log("✅ Reference data loaded");
}

function setupEvents() {
    dropZone.onclick = () => fileInput.click();
    fileInput.onchange = (e) => handleFile(e.target.files[0]);
    
    dropZone.ondragover = (e) => { e.preventDefault(); dropZone.style.borderColor = 'var(--primary)'; };
    dropZone.ondragleave = () => dropZone.style.borderColor = 'var(--glass-border)';
    dropZone.ondrop = (e) => {
        e.preventDefault();
        handleFile(e.dataTransfer.files[0]);
    };

    btnDownload.onclick = downloadTemplate;
    btnRetry.onclick = retryFailed;
    btnFinalize.onclick = finalizeImport;

    // Tabs logic
    const statGrid = document.querySelector('.stat-grid');
    if (tabBulk && tabManual) {
        tabBulk.onclick = () => {
            tabBulk.classList.add('active');
            tabManual.classList.remove('active');
            manualView.style.display = 'none';
            bulkHeaderActions.style.display = 'flex';
            if (statGrid) statGrid.style.display = 'grid';
            if (state.allRows.length > 0) {
                resultsTable.style.display = 'block';
                if (state.failedRows.length > 0) retryBanner.style.display = 'flex';
            } else {
                uploadView.style.display = 'block';
            }
        };

        tabManual.onclick = () => {
            tabManual.classList.add('active');
            tabBulk.classList.remove('active');
            uploadView.style.display = 'none';
            resultsTable.style.display = 'none';
            retryBanner.style.display = 'none';
            progressView.style.display = 'none';
            bulkHeaderActions.style.display = 'none';
            if (statGrid) statGrid.style.display = 'none';
            manualView.style.display = 'block';
        };
    }

    if (btnManualClear) {
        btnManualClear.onclick = () => {
            if (manualOnboardForm) manualOnboardForm.reset();
        };
    }

    if (manualOnboardForm) {
        manualOnboardForm.onsubmit = handleManualSubmit;
    }
}

function downloadTemplate() {
    const headers = [
        "Employee ID / Rego No", "Employee Name", "Official Email", "Personal Email", "Department", 
        "Sub-Department", "Designation", "Reporting Manager", "Employment Type", 
        "Business Unit", "Legal Entity", "Joining Date", "Phone Number", "Role"
    ];
    const ws = XLSX.utils.aoa_to_sheet([headers]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "OnboardingTemplate");
    XLSX.writeFile(wb, "HRFlow_Bulk_Onboarding_Template.xlsx");
}

async function handleFile(file) {
    if (!file || state.isProcessing) return;
    state.isProcessing = true;
    state.currentFile = file;
    
    document.getElementById('uploadView').style.display = 'none';
    progressView.style.display = 'block';
    
    // 1. Process Excel/CSV locally first (Instant and resilient UX)
    const reader = new FileReader();
    reader.onload = async (e) => {
        try {
            const data = new Uint8Array(e.target.result);
            const workbook = XLSX.read(data, { type: 'array' });
            const json = XLSX.utils.sheet_to_json(workbook.Sheets[workbook.SheetNames[0]]);
            await processBatch(json);
            
            // 2. Asynchronously upload to Firebase Storage in background (non-blocking)
            uploadToStorageBackground(file);
        } catch (err) {
            console.error("❌ Local file parsing failed:", err);
            window.showCustomAlert("Error", "Failed to parse the uploaded file. Please verify it is a valid Excel or CSV sheet.", "error");
            state.isProcessing = false;
            document.getElementById('uploadView').style.display = 'block';
            progressView.style.display = 'none';
        }
    };
    reader.readAsArrayBuffer(file);
}

async function uploadToStorageBackground(file) {
    try {
        const fileRef = ref(storage, `bulk_onboarding/${Date.now()}_${file.name}`);
        await uploadBytes(fileRef, file);
        state.fileURL = await getDownloadURL(fileRef);
        console.log("📁 File uploaded to Storage in background:", state.fileURL);
    } catch (err) {
        console.warn("⚠️ Background Storage upload failed (this does not affect onboarding):", err.message);
    }
}

function getValueCaseInsensitive(obj, possibleKeys) {
    const objKeys = Object.keys(obj);
    for (const key of possibleKeys) {
        const foundKey = objKeys.find(k => k.trim().toLowerCase() === key.toLowerCase());
        if (foundKey && obj[foundKey] !== undefined && obj[foundKey] !== null) {
            return obj[foundKey];
        }
    }
    return undefined;
}

function normalizeRowKeys(row) {
    const normalized = {};
    
    // 1. Normalize Official Email
    normalized["Official Email"] = getValueCaseInsensitive(row, [
        "Official Email", "Email", "Email Address", "Official Email Address", "official_email", "official-email"
    ]);
    
    // 2. Normalize Employee Name
    normalized["Employee Name"] = getValueCaseInsensitive(row, [
        "Employee Name", "Name", "Full Name", "Employee_Name", "employee-name"
    ]);
    
    // 3. Normalize Reporting Manager
    normalized["Reporting Manager"] = getValueCaseInsensitive(row, [
        "Reporting Manager", "Manager", "Reporting Manager Name", "Reporting Manager Email", "reporting_manager", "reporting-manager"
    ]);
    
    // 4. Normalize Employee ID / Rego No
    normalized["Employee ID / Rego No"] = getValueCaseInsensitive(row, [
        "Employee ID / Rego No", "Rego No", "Employee ID", "Rego No.", "Employee Code", "employee_id", "rego_no", "employee-id", "rego-no"
    ]);
    
    // 5. Normalize Joining Date
    normalized["Joining Date"] = getValueCaseInsensitive(row, [
        "Joining Date", "Date of Joining", "DOJ", "joining_date", "joining-date"
    ]);
    
    // 6. Normalize Role
    normalized["Role"] = getValueCaseInsensitive(row, [
        "Role", "role"
    ]);
    
    // 7. Normalize Department
    normalized["Department"] = getValueCaseInsensitive(row, [
        "Department", "Dept", "department"
    ]);
    
    // 8. Normalize Designation
    normalized["Designation"] = getValueCaseInsensitive(row, [
        "Designation", "designation"
    ]);

    // Apply robust defaults for optional/missing values
    if (!normalized["Role"]) normalized["Role"] = "employee";
    if (!normalized["Department"]) normalized["Department"] = "Engineering";
    if (!normalized["Designation"]) normalized["Designation"] = "Staff";
    if (!normalized["Joining Date"]) {
        normalized["Joining Date"] = new Date().toISOString().split('T')[0];
    }

    return normalized;
}

async function processBatch(data) {
    state.allRows = data;
    state.stats = { total: data.length, success: 0, failed: 0, dupes: 0 };
    state.successRows = [];
    state.failedRows = [];
    
    updateStatsDisplay();

    for (let i = 0; i < data.length; i++) {
        const rawRow = data[i];
        const row = normalizeRowKeys(rawRow);
        const validation = validateRow(row, i + 1);
        
        if (validation.isValid) {
            state.stats.success++;
            state.successRows.push({ ...row, rowIndex: i + 1 });
        } else {
            state.stats.failed++;
            if (validation.isDupe) state.stats.dupes++;
            state.failedRows.push({ ...row, rowIndex: i + 1, errors: validation.errors });
        }

        updateProgress(i + 1, data.length);
        if (i % 5 === 0) await new Promise(r => setTimeout(r, 10)); // UI Breath
    }

    renderResults();
    state.isProcessing = false;
}

function generateFallbackEmployeeId(deptName) {
    const deptCode = (deptName || "ENG").substring(0, 3).toUpperCase();
    const rand = Math.floor(1000 + Math.random() * 9000);
    return `EMP${deptCode}${rand}`;
}

function validateRow(row, index) {
    const errors = [];
    let isDupe = false;

    const required = ["Official Email", "Employee Name", "Department", "Designation", "Reporting Manager", "Joining Date", "Role"];
    
    required.forEach(f => {
        if (!row[f]) errors.push(`Missing field: ${f}`);
    });

    const empIdVal = (row["Employee ID / Rego No"] || row["Rego No"] || row["Employee ID"] || "").toString().trim().toLowerCase();
    if (empIdVal && state.existingEmployeeIds.includes(empIdVal)) {
        errors.push(`Employee ID / Rego No "${row["Employee ID / Rego No"] || row["Rego No"] || row["Employee ID"]}" already exists`);
        isDupe = true;
    }

    const role = (row["Role"] || "").trim().toLowerCase();
    if (role && role !== "employee" && role !== "manager") {
        errors.push(`Invalid role: "${row["Role"]}". Must be strictly "employee" or "manager".`);
    }

    const email = (row["Official Email"] || "").trim().toLowerCase();
    if (email) {
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) errors.push("Invalid email format");
        if (state.existingEmails.includes(email)) {
            errors.push("Email already exists in HRMS");
            isDupe = true;
        }
    }

    // Note: We warn on reporting manager not found but do not block validation
    const manager = row["Reporting Manager"];
    if (manager) {
        const found = state.managers.find(m => 
            m.name?.toLowerCase() === manager.toLowerCase() || 
            m.email?.toLowerCase() === manager.toLowerCase() ||
            m.fullName?.toLowerCase() === manager.toLowerCase()
        );
        if (!found) {
            console.warn(`Reporting Manager "${manager}" not found in database (will save as text string).`);
        }
    }

    return { isValid: errors.length === 0, errors, isDupe };
}

function updateProgress(curr, total) {
    const p = Math.round((curr / total) * 100);
    document.getElementById('progressFill').style.width = `${p}%`;
    document.getElementById('progressPercent').innerText = `${p}%`;
    document.getElementById('progressDetail').innerText = `Validating row ${curr} of ${total}...`;
    
    if (p === 100) {
        setTimeout(() => {
            progressView.style.display = 'none';
            resultsTable.style.display = 'block';
            updateStatsDisplay();
            if (state.failedRows.length > 0) retryBanner.style.display = 'flex';
            btnFinalize.disabled = state.successRows.length === 0;
        }, 500);
    }
}

function updateStatsDisplay() {
    elTotal.innerText = state.stats.total;
    elSuccess.innerText = state.stats.success;
    elFailed.innerText = state.stats.failed;
    elDupes.innerText = state.stats.dupes;
}

function renderResults() {
    const all = [...state.failedRows, ...state.successRows].sort((a,b) => a.rowIndex - b.rowIndex);
    resultsBody.innerHTML = all.map(row => {
        const empId = row["Employee ID / Rego No"] || row["Rego No"] || row["Employee ID"] || "Auto-generated";
        return `
            <tr>
                <td>${row.rowIndex}</td>
                <td>
                    <span class="status-badge ${row.errors ? 'badge-error' : 'badge-success'}">
                        ${row.errors ? 'FAILED' : 'VALID'}
                    </span>
                </td>
                <td>${empId}</td>
                <td>${row["Employee Name"] || 'N/A'}</td>
                <td>${row["Official Email"] || 'N/A'}</td>
                <td>${row["Reporting Manager"] || 'N/A'}</td>
                <td style="color: var(--danger); font-size: 0.75rem;">
                    ${row.errors ? row.errors.join('<br>') : '<span style="color: var(--secondary)">None</span>'}
                </td>
            </tr>
        `;
    }).join('');
    if (window.lucide) lucide.createIcons();
}

async function retryFailed() {
    const toRetry = state.failedRows.map(r => {
        const { errors, rowIndex, ...rest } = r;
        return rest;
    });
    
    resultsTable.style.display = 'none';
    retryBanner.style.display = 'none';
    progressView.style.display = 'block';
    
    await processBatch(toRetry);
}

async function finalizeImport() {
    btnFinalize.disabled = true;
    btnFinalize.innerHTML = '<i data-lucide="loader" class="animate-spin"></i> Finalizing...';
    lucide.createIcons();

    // 1. Log the session
    const sessionRef = await addDoc(collection(db, "bulk_upload_sessions"), {
        performer: auth.currentUser?.email || "admin",
        timestamp: serverTimestamp(),
        totalRows: state.stats.total,
        successCount: state.successRows.length,
        failedCount: state.stats.failed
    });

    // 2. Create employees and send invites
    for (const row of state.successRows) {
        const onboardingToken = `HRFLOW-${Math.random().toString(36).substr(2, 9).toUpperCase()}`;
        const expiryDate = new Date();
        expiryDate.setHours(expiryDate.getHours() + 3); // 3-hour security window

        // Generate temporary password
        const generatedPassword = `Kylrx-${Math.random().toString(36).substr(2, 6).toUpperCase()}!`;

        // Determine role strictly from the CSV Role field
        const role = row["Role"].trim().toLowerCase();

        const empId = `emp_${Math.random().toString(36).substr(2, 9)}`;
        const customEmpId = (row["Employee ID / Rego No"] || row["Rego No"] || row["Employee ID"] || "").toString().trim();
        const finalEmployeeId = customEmpId || generateFallbackEmployeeId(row["Department"]);

        const empData = {
            employeeId: finalEmployeeId,
            fullName: row["Employee Name"],
            email: row["Official Email"].toLowerCase(),
            personalEmail: row["Personal Email"] || "",
            department: row["Department"],
            subDepartment: row["Sub-Department"] || "",
            designation: row["Designation"],
            reportingManager: row["Reporting Manager"],
            employmentType: row["Employment Type"] || "Full-time",
            businessUnit: row["Business Unit"] || "Default",
            legalEntity: row["Legal Entity"] || "Default",
            joiningDate: row["Joining Date"],
            phoneNumber: row["Phone Number"] || "",
            status: "Invitation Sent", 
            onboardingStatus: "Invitation Sent",
            onboardingToken: onboardingToken,
            onboardingTokenExpiry: expiryDate,
            role: role,
            tempPassword: generatedPassword,
            password: generatedPassword,
            createdAt: serverTimestamp(),
            sessionId: sessionRef.id
        };

        const inviteLink = `${targetOrigin}/onboarding-invite.html?token=${onboardingToken}&id=${empId}`;
        console.log(`✉️ Sending Invites for ${empData.fullName}:`);
        console.log(`   Official: ${empData.email}`);
        console.log(`   Personal: ${empData.personalEmail}`);
        console.log(`   Secure Link: ${inviteLink}`);

        // Construct HTML body
        const html = `
            <div style="font-family: 'Outfit', sans-serif; max-width: 600px; margin: 0 auto; padding: 30px; border: 1px solid #e2e8f0; border-radius: 24px; background-color: #ffffff; box-shadow: 0 4px 20px rgba(0, 0, 0, 0.03);">
                <div style="text-align: center; margin-bottom: 24px;">
                    <h2 style="color: #3b82f6; font-weight: 800; font-size: 1.8rem; margin: 0; letter-spacing: -0.5px;">Kylrx <span style="color: #0f172a;">AI</span></h2>
                    <p style="color: #64748b; font-size: 0.9rem; margin-top: 4px; font-weight: 500;">Enterprise Onboarding Portal</p>
                </div>
                
                <hr style="border: 0; border-top: 1px solid #e2e8f0; margin-bottom: 24px;" />
                
                <p style="font-size: 1rem; color: #0f172a; line-height: 1.6;">Dear <strong>${empData.fullName}</strong>,</p>
                <p style="font-size: 0.95rem; color: #334155; line-height: 1.6;">Welcome to the Kylrx AI team! Your profile has been successfully provisioned. You have been onboarded as a <strong>${role.toUpperCase()}</strong> in the <strong>${empData.department}</strong> department.</p>
                
                <div style="background-color: #f8fafc; border: 1px solid #e2e8f0; border-radius: 16px; padding: 20px; margin: 24px 0;">
                    <h3 style="margin-top: 0; color: #0f172a; font-size: 0.95rem; font-weight: 700; text-transform: uppercase; letter-spacing: 0.5px;">Access Credentials</h3>
                    <table style="width: 100%; border-collapse: collapse; font-size: 0.9rem;">
                        <tr>
                            <td style="padding: 6px 0; color: #64748b; width: 140px;">Employee ID / Rego No:</td>
                            <td style="padding: 6px 0; color: #0f172a; font-weight: 600;">${empData.employeeId}</td>
                        </tr>
                        <tr>
                            <td style="padding: 6px 0; color: #64748b; width: 140px;">Login Email:</td>
                            <td style="padding: 6px 0; color: #0f172a; font-weight: 600;">${empData.email}</td>
                        </tr>
                        <tr>
                            <td style="padding: 6px 0; color: #64748b;">Temp Password:</td>
                            <td style="padding: 6px 0; color: #3b82f6; font-family: monospace; font-weight: 700; font-size: 1rem;">${generatedPassword}</td>
                        </tr>
                        <tr>
                            <td style="padding: 6px 0; color: #64748b;">Role assigned:</td>
                            <td style="padding: 6px 0; color: #0f172a; font-weight: 600;">${role.charAt(0).toUpperCase() + role.slice(1)}</td>
                        </tr>
                    </table>
                </div>

                <h3 style="color: #0f172a; font-size: 0.95rem; font-weight: 700; margin-bottom: 12px;">How to Access Your Account</h3>
                <ol style="font-size: 0.9rem; color: #334155; line-height: 1.6; padding-left: 20px; margin-bottom: 24px;">
                    <li style="margin-bottom: 8px;">Click the <strong>"Start Onboarding"</strong> button below to open your secure invitation link.</li>
                    <li style="margin-bottom: 8px;">Or go to the portal and log in with your credentials.</li>
                    <li style="margin-bottom: 8px;"><strong>Auto-Login via Google:</strong> You can automatically log in using your Google/Gmail account matching <strong>${empData.email}</strong> by clicking "Sign in with Google" on the login page.</li>
                </ol>
                
                <div style="text-align: center; margin: 30px 0;">
                    <a href="${inviteLink}" 
                       style="background-color: #3b82f6; color: white; padding: 14px 32px; text-decoration: none; border-radius: 12px; font-weight: 700; font-size: 0.95rem; display: inline-block; box-shadow: 0 4px 12px rgba(59, 130, 246, 0.2);">
                       Start Onboarding Flow
                    </a>
                </div>
                
                <hr style="border: 0; border-top: 1px solid #e2e8f0; margin: 24px 0;" />
                <p style="font-size: 0.75rem; color: #94a3b8; line-height: 1.4; text-align: center;">This is a system-generated onboarding notification from Kylrx AI HRMS. Please do not reply directly to this email.</p>
            </div>
        `;

        // Send email invites to both official and personal emails if personal email is provided
        const recipients = [...new Set([empData.email, empData.personalEmail].filter(Boolean))];

        try {
            const emailResponse = await fetch(`${apiBase}/api/email/send`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    to: recipients,
                    subject: 'Welcome to Kylrx AI - Secure Onboarding Invitation',
                    html: html
                })
            });
            const emailResult = await emailResponse.json();
            if (emailResult.success) {
                console.log(`✅ Onboarding invite email sent to ${recipients.join(', ')}`);
            } else {
                console.error(`❌ Onboarding invite email failed:`, emailResult.error);
            }
        } catch (emailErr) {
            console.error(`❌ Failed to request /api/email/send:`, emailErr.message);
        }

        await setDoc(doc(db, "users", empId), empData);
    }

    window.customAlertCallback = () => { window.location.reload(); };
    window.showCustomAlert("Import Success", `Successfully imported ${state.successRows.length} employees. Initializing lifecycle workflows and email invitations...`, "success");
}

async function handleManualSubmit(e) {
    e.preventDefault();
    
    const customEmpId = document.getElementById('manualEmployeeId').value.trim();
    const name = document.getElementById('manualName').value.trim();
    const officialEmail = document.getElementById('manualOfficialEmail').value.trim().toLowerCase();
    const personalEmail = document.getElementById('manualPersonalEmail').value.trim();
    const phone = document.getElementById('manualPhone').value.trim();
    const department = document.getElementById('manualDept').value.trim();
    const role = document.getElementById('manualRole').value;
    const reportingManager = document.getElementById('manualManager').value;
    const joiningDate = document.getElementById('manualJoiningDate').value;
    const employmentType = document.getElementById('manualEmploymentType').value;

    // Validation
    if (!name || !officialEmail || !department || !reportingManager || !joiningDate || !role) {
        window.showCustomAlert("Validation Error", "Please fill in all required fields.", "error");
        return;
    }

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(officialEmail)) {
        window.showCustomAlert("Validation Error", "Invalid official email format.", "error");
        return;
    }

    if (state.existingEmails.includes(officialEmail)) {
        window.showCustomAlert("Validation Error", "This email is already registered in the system.", "error");
        return;
    }

    if (customEmpId && state.existingEmployeeIds.includes(customEmpId.toLowerCase())) {
        window.showCustomAlert("Validation Error", `Employee ID / Rego No "${customEmpId}" is already registered.`, "error");
        return;
    }

    const btnSubmit = document.getElementById('btnManualSubmit');
    if (btnSubmit) {
        btnSubmit.disabled = true;
        btnSubmit.innerHTML = '<i data-lucide="loader" class="animate-spin"></i> Onboarding...';
        if (window.lucide) lucide.createIcons();
    }

    try {
        const onboardingToken = `HRFLOW-${Math.random().toString(36).substr(2, 9).toUpperCase()}`;
        const expiryDate = new Date();
        expiryDate.setHours(expiryDate.getHours() + 3);

        const generatedPassword = `Kylrx-${Math.random().toString(36).substr(2, 6).toUpperCase()}!`;
        const empId = `emp_${Math.random().toString(36).substr(2, 9)}`;
        const designation = role.charAt(0).toUpperCase() + role.slice(1);
        const finalEmployeeId = customEmpId || generateFallbackEmployeeId(department);

        const empData = {
            employeeId: finalEmployeeId,
            fullName: name,
            email: officialEmail,
            personalEmail: personalEmail,
            department: department,
            subDepartment: "",
            designation: designation,
            reportingManager: reportingManager,
            employmentType: employmentType,
            businessUnit: "Default",
            legalEntity: "Default",
            joiningDate: joiningDate,
            phoneNumber: phone,
            status: "Invitation Sent", 
            onboardingStatus: "Invitation Sent",
            onboardingToken: onboardingToken,
            onboardingTokenExpiry: expiryDate,
            role: role,
            tempPassword: generatedPassword,
            password: generatedPassword,
            createdAt: serverTimestamp(),
            sessionId: "manual"
        };

        const inviteLink = `${targetOrigin}/onboarding-invite.html?token=${onboardingToken}&id=${empId}`;

        // Construct HTML body
        const html = `
            <div style="font-family: 'Outfit', sans-serif; max-width: 600px; margin: 0 auto; padding: 30px; border: 1px solid #e2e8f0; border-radius: 24px; background-color: #ffffff; box-shadow: 0 4px 20px rgba(0, 0, 0, 0.03);">
                <div style="text-align: center; margin-bottom: 24px;">
                    <h2 style="color: #3b82f6; font-weight: 800; font-size: 1.8rem; margin: 0; letter-spacing: -0.5px;">Kylrx <span style="color: #0f172a;">AI</span></h2>
                    <p style="color: #64748b; font-size: 0.9rem; margin-top: 4px; font-weight: 500;">Enterprise Onboarding Portal</p>
                </div>
                
                <hr style="border: 0; border-top: 1px solid #e2e8f0; margin-bottom: 24px;" />
                
                <p style="font-size: 1rem; color: #0f172a; line-height: 1.6;">Dear <strong>${empData.fullName}</strong>,</p>
                <p style="font-size: 0.95rem; color: #334155; line-height: 1.6;">Welcome to the Kylrx AI team! Your profile has been successfully provisioned. You have been onboarded as a <strong>${role.toUpperCase()}</strong> in the <strong>${empData.department}</strong> department.</p>
                
                <div style="background-color: #f8fafc; border: 1px solid #e2e8f0; border-radius: 16px; padding: 20px; margin: 24px 0;">
                    <h3 style="margin-top: 0; color: #0f172a; font-size: 0.95rem; font-weight: 700; text-transform: uppercase; letter-spacing: 0.5px;">Access Credentials</h3>
                    <table style="width: 100%; border-collapse: collapse; font-size: 0.9rem;">
                        <tr>
                            <td style="padding: 6px 0; color: #64748b; width: 140px;">Employee ID / Rego No:</td>
                            <td style="padding: 6px 0; color: #0f172a; font-weight: 600;">${empData.employeeId}</td>
                        </tr>
                        <tr>
                            <td style="padding: 6px 0; color: #64748b; width: 140px;">Login Email:</td>
                            <td style="padding: 6px 0; color: #0f172a; font-weight: 600;">${empData.email}</td>
                        </tr>
                        <tr>
                            <td style="padding: 6px 0; color: #64748b;">Temp Password:</td>
                            <td style="padding: 6px 0; color: #3b82f6; font-family: monospace; font-weight: 700; font-size: 1rem;">${generatedPassword}</td>
                        </tr>
                        <tr>
                            <td style="padding: 6px 0; color: #64748b;">Role assigned:</td>
                            <td style="padding: 6px 0; color: #0f172a; font-weight: 600;">${role.charAt(0).toUpperCase() + role.slice(1)}</td>
                        </tr>
                    </table>
                </div>

                <h3 style="color: #0f172a; font-size: 0.95rem; font-weight: 700; margin-bottom: 12px;">How to Access Your Account</h3>
                <ol style="font-size: 0.9rem; color: #334155; line-height: 1.6; padding-left: 20px; margin-bottom: 24px;">
                    <li style="margin-bottom: 8px;">Click the <strong>"Start Onboarding"</strong> button below to open your secure invitation link.</li>
                    <li style="margin-bottom: 8px;">Or go to the portal and log in with your credentials.</li>
                    <li style="margin-bottom: 8px;"><strong>Auto-Login via Google:</strong> You can automatically log in using your Google/Gmail account matching <strong>${empData.email}</strong> by clicking "Sign in with Google" on the login page.</li>
                </ol>
                
                <div style="text-align: center; margin: 30px 0;">
                    <a href="${inviteLink}" 
                       style="background-color: #3b82f6; color: white; padding: 14px 32px; text-decoration: none; border-radius: 12px; font-weight: 700; font-size: 0.95rem; display: inline-block; box-shadow: 0 4px 12px rgba(59, 130, 246, 0.2);">
                       Start Onboarding Flow
                    </a>
                </div>
                
                <hr style="border: 0; border-top: 1px solid #e2e8f0; margin: 24px 0;" />
                <p style="font-size: 0.75rem; color: #94a3b8; line-height: 1.4; text-align: center;">This is a system-generated onboarding notification from Kylrx AI HRMS. Please do not reply directly to this email.</p>
            </div>
        `;

        const recipients = [...new Set([empData.email, empData.personalEmail].filter(Boolean))];

        const emailResponse = await fetch(`${apiBase}/api/email/send`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                to: recipients,
                subject: 'Welcome to Kylrx AI - Secure Onboarding Invitation',
                html: html
            })
        });
        const emailResult = await emailResponse.json();
        if (emailResult.success) {
            console.log(`✅ Onboarding invite email sent to ${recipients.join(', ')}`);
        } else {
            console.error(`❌ Onboarding invite email failed:`, emailResult.error);
        }

        await setDoc(doc(db, "users", empId), empData);
        window.customAlertCallback = () => { window.location.reload(); };
        window.showCustomAlert("Onboarding Success", `Successfully onboarded ${name} as a ${role}. Secure email invite has been sent.`, "success");
    } catch (err) {
        console.error("❌ Manual onboarding failed:", err);
        window.showCustomAlert("Onboarding Error", "An error occurred during onboarding: " + err.message, "error");
        if (btnSubmit) {
            btnSubmit.disabled = false;
            btnSubmit.innerHTML = '<i data-lucide="user-plus"></i> Submit Onboarding';
            if (window.lucide) lucide.createIcons();
        }
    }
}

// Global custom alerts logic
window.customAlertCallback = null;

window.showCustomAlert = (title, msg, type = 'success') => {
    const overlay = document.getElementById('customAlertOverlay');
    if (!overlay) {
        console.warn("Custom alert overlay not found, falling back to standard alert:", title, msg);
        const nativeAlert = window.nativeAlert || alert;
        nativeAlert(`${title}: ${msg}`);
        return;
    }
    
    document.getElementById('customAlertTitle').textContent = title;
    document.getElementById('customAlertMsg').textContent = msg;
    
    const icon = document.getElementById('customAlertIcon');
    if (icon) {
        let iconName = 'info';
        let color = '#3b82f6';
        let bg = '#eff6ff';
        
        if (type === 'success') {
            iconName = 'check-circle';
            color = '#10b981';
            bg = '#dcfce7';
        } else if (type === 'error') {
            iconName = 'alert-circle';
            color = '#ef4444';
            bg = '#fee2e2';
        } else if (type === 'warning') {
            iconName = 'alert-triangle';
            color = '#d97706';
            bg = '#fffbeb';
        }
        
        icon.setAttribute('data-lucide', iconName);
        icon.parentElement.style.color = color;
        icon.parentElement.style.background = bg;
    }
    
    if (window.lucide) lucide.createIcons();
    overlay.style.display = 'flex';
};

window.closeCustomAlert = () => {
    const overlay = document.getElementById('customAlertOverlay');
    if (overlay) overlay.style.display = 'none';
    if (window.customAlertCallback) {
        const cb = window.customAlertCallback;
        window.customAlertCallback = null;
        cb();
    }
};

// Store standard alert reference and override it globally
window.nativeAlert = window.alert;
window.alert = (message) => {
    window.showCustomAlert('Notice', message, 'info');
};
