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
    managers: [],
    stats: { total: 0, success: 0, failed: 0, dupes: 0 },
    isProcessing: false
};

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
        state.managers = usersSnap.docs
            .map(d => ({ id: d.id, ...d.data() }))
            .filter(u => ['manager', 'admin', 'hr'].includes(u.role?.toLowerCase()));
        console.log("✅ Reference data loaded");
    } catch (err) {
        console.error("❌ Reference data load failed", err);
    }
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
}

function downloadTemplate() {
    const headers = [
        "Official Email", "Personal Email", "Employee Name", "Department", 
        "Sub-Department", "Designation", "Reporting Manager", "Employment Type", 
        "Business Unit", "Legal Entity", "Joining Date", "Phone Number"
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
    
    try {
        // 1. Upload to Firebase Storage for audit/history
        const fileRef = ref(storage, `bulk_onboarding/${Date.now()}_${file.name}`);
        const uploadTask = await uploadBytes(fileRef, file);
        state.fileURL = await getDownloadURL(fileRef);
        console.log("📁 File uploaded to Storage:", state.fileURL);

        // 2. Read and Process
        const reader = new FileReader();
        reader.onload = async (e) => {
            const data = new Uint8Array(e.target.result);
            const workbook = XLSX.read(data, { type: 'array' });
            const json = XLSX.utils.sheet_to_json(workbook.Sheets[workbook.SheetNames[0]]);
            await processBatch(json);
        };
        reader.readAsArrayBuffer(file);
    } catch (err) {
        console.error("❌ Storage upload failed:", err);
        alert("Upload failed. Continuing with local processing...");
        // Fallback to local reading
        const reader = new FileReader();
        reader.onload = async (e) => {
            const data = new Uint8Array(e.target.result);
            const workbook = XLSX.read(data, { type: 'array' });
            const json = XLSX.utils.sheet_to_json(workbook.Sheets[workbook.SheetNames[0]]);
            await processBatch(json);
        };
        reader.readAsArrayBuffer(file);
    }
}

async function processBatch(data) {
    state.allRows = data;
    state.stats = { total: data.length, success: 0, failed: 0, dupes: 0 };
    state.successRows = [];
    state.failedRows = [];
    
    updateStatsDisplay();

    for (let i = 0; i < data.length; i++) {
        const row = data[i];
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

function validateRow(row, index) {
    const errors = [];
    let isDupe = false;

    const required = ["Official Email", "Employee Name", "Department", "Designation", "Reporting Manager", "Joining Date"];
    
    required.forEach(f => {
        if (!row[f]) errors.push(`Missing field: ${f}`);
    });

    const email = (row["Official Email"] || "").trim().toLowerCase();
    if (email) {
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) errors.push("Invalid email format");
        if (state.existingEmails.includes(email)) {
            errors.push("Email already exists in HRMS");
            isDupe = true;
        }
    }

    const manager = row["Reporting Manager"];
    if (manager) {
        const found = state.managers.find(m => 
            m.name?.toLowerCase() === manager.toLowerCase() || 
            m.email?.toLowerCase() === manager.toLowerCase()
        );
        if (!found) errors.push(`Manager "${manager}" not found in system`);
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
    resultsBody.innerHTML = all.map(row => `
        <tr>
            <td>${row.rowIndex}</td>
            <td>
                <span class="status-badge ${row.errors ? 'badge-error' : 'badge-success'}">
                    ${row.errors ? 'FAILED' : 'VALID'}
                </span>
            </td>
            <td>${row["Employee Name"] || 'N/A'}</td>
            <td>${row["Official Email"] || 'N/A'}</td>
            <td>${row["Reporting Manager"] || 'N/A'}</td>
            <td style="color: var(--danger); font-size: 0.75rem;">
                ${row.errors ? row.errors.join('<br>') : '<span style="color: var(--secondary)">None</span>'}
            </td>
        </tr>
    `).join('');
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

        const onboardingToken = `HRFLOW-${Math.random().toString(36).substr(2, 9).toUpperCase()}`;
        const expiryDate = new Date();
        expiryDate.setHours(expiryDate.getHours() + 3); // 3-hour security window

        const empId = `emp_${Math.random().toString(36).substr(2, 9)}`;
        const empData = {
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
            role: "employee",
            createdAt: serverTimestamp(),
            sessionId: sessionRef.id
        };

        const inviteLink = `${window.location.origin}/onboarding-invite.html?token=${onboardingToken}&id=${empId}`;
        console.log(`✉️ Sending Invites for ${empData.fullName}:`);
        console.log(`   Official: ${empData.email}`);
        console.log(`   Personal: ${empData.personalEmail}`);
        console.log(`   Secure Link: ${inviteLink}`);

        await setDoc(doc(db, "users", empId), empData);
    }

    alert(`Successfully imported ${state.successRows.length} employees. Initializing lifecycle workflows...`);
    window.location.reload();
}
